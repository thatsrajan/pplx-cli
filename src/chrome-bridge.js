/**
 * Chrome CDP Bridge — executes fetch() inside Chrome's Perplexity tab
 * to bypass Cloudflare TLS fingerprinting.
 * 
 * Connects via OpenClaw browser relay (ws://127.0.0.1:18793/cdp)
 * or direct Chrome DevTools Protocol.
 */
import WebSocket from 'ws';

const RELAY_URL = 'ws://127.0.0.1:18793/cdp';
const RELAY_LIST = 'http://127.0.0.1:18793/json/list';
const CDP_LIST = 'http://localhost:9222/json';

export class ChromeBridge {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.msgId = 0;
    this.pending = new Map();
  }

  async connect() {
    // Find the Perplexity tab
    let tabs, wsUrl;
    try {
      const resp = await fetch(RELAY_LIST);
      tabs = await resp.json();
      wsUrl = RELAY_URL;
    } catch {
      try {
        const resp = await fetch(CDP_LIST);
        tabs = await resp.json();
      } catch {
        throw new Error(
          'Cannot connect to Chrome.\n' +
          '  Ensure OpenClaw gateway is running (openclaw gateway start)\n' +
          '  and a Perplexity tab is open in Chrome.'
        );
      }
    }

    const pplxTab = tabs.find(t => t.url?.includes('perplexity.ai'));
    if (!pplxTab) {
      throw new Error(
        'No Perplexity tab found in Chrome.\n' +
        '  Open https://www.perplexity.ai/ in Chrome and try again.'
      );
    }

    const targetId = pplxTab.id || pplxTab.targetId;
    const connectUrl = wsUrl || pplxTab.webSocketDebuggerUrl;

    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(connectUrl);
      this.ws.on('open', resolve);
      this.ws.on('message', (raw) => this._onMessage(raw));
      this.ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    });

    // Attach to the Perplexity tab
    if (wsUrl === RELAY_URL) {
      const resp = await this._sendAsync('Target.attachToTarget', {
        targetId,
        flatten: true,
      });
      this.sessionId = resp.result.sessionId;
    }
  }

  _onMessage(raw) {
    const msg = JSON.parse(raw.toString());
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg);
    }
  }

  _sendAsync(method, params = {}, timeout = 60000) {
    const id = ++this.msgId;
    const msg = { id, method, params };
    if (this.sessionId) msg.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout for ${method}`));
        }
      }, timeout);
    });
  }

  /**
   * Execute JavaScript in Chrome's Perplexity tab and return result.
   */
  async evaluate(expression, awaitPromise = true) {
    const resp = await this._sendAsync('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (resp.result?.exceptionDetails) {
      const desc = resp.result.exceptionDetails.exception?.description || 'Unknown error';
      throw new Error('Chrome eval error: ' + desc);
    }
    return resp.result?.result?.value;
  }

  /**
   * Execute a streaming fetch — stores chunks in Chrome, polls them back.
   * Returns an async generator of SSE text chunks.
   */
  async *fetchSSE(url, fetchOpts = {}) {
    const storeId = '_pplx_' + Date.now();

    // Start the fetch in Chrome
    await this.evaluate(`
      (async () => {
        window.${storeId} = { chunks: [], done: false, error: null, status: 0 };
        try {
          const r = await fetch(${JSON.stringify(url)}, ${JSON.stringify(fetchOpts)});
          window.${storeId}.status = r.status;
          if (!r.ok) {
            window.${storeId}.error = 'HTTP ' + r.status + ': ' + (await r.text()).substring(0, 500);
            window.${storeId}.done = true;
            return;
          }
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            window.${storeId}.chunks.push(decoder.decode(value, { stream: true }));
          }
        } catch (e) {
          window.${storeId}.error = e.message;
        }
        window.${storeId}.done = true;
      })();
      'started'
    `, false); // Don't await — let it run in background

    // Poll for chunks
    const deadline = Date.now() + (fetchOpts.timeout ?? 120000);
    await new Promise(r => setTimeout(r, 200)); // Give it a moment to start
    try {
      while (true) {
        if (Date.now() > deadline) throw new Error('SSE polling timeout');
        const stateJson = await this.evaluate(`
          (() => {
            const s = window['${storeId}'];
            if (!s) return JSON.stringify({ chunks: [], done: true, error: 'store missing' });
            const c = s.chunks.splice(0);
            return JSON.stringify({ chunks: c, done: s.done, error: s.error, status: s.status });
          })()
        `, false);

        const state = JSON.parse(stateJson);

        if (state.error) {
          throw new Error(state.error);
        }

        for (const chunk of state.chunks) {
          yield chunk;
        }

        if (state.done) break;
        await new Promise(r => setTimeout(r, 100));
      }
    } finally {
      await this.evaluate(`delete window['${storeId}']`, false).catch(() => {});
    }
  }

  close() {
    this.ws?.close();
  }
}
