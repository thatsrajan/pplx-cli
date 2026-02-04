import WebSocket from 'ws';
import { HEADERS, BASE_URL } from './constants.js';

export function parseEngineIO(text) {
  const match = text.match(/^(\d+):(.+)$/s);
  const payload = match ? match[2] : text;
  const braceIdx = payload.indexOf('{');
  if (braceIdx === -1) throw new Error('No JSON found in Engine.IO response');
  return JSON.parse(payload.slice(braceIdx));
}

export class LabsClient {
  constructor() {
    this.ws = null;
    this.sid = null;
    this.history = [];
    this.cookies = '';
    // Message queue pattern to avoid race condition
    this._queue = [];
    this._waiter = null;
  }

  _pushMessage(msg) {
    if (this._waiter) {
      const resolve = this._waiter;
      this._waiter = null;
      resolve(msg);
    } else {
      this._queue.push(msg);
    }
  }

  _nextMessage() {
    if (this._queue.length > 0) {
      return Promise.resolve(this._queue.shift());
    }
    return new Promise((resolve) => { this._waiter = resolve; });
  }

  async connect() {
    const t = Math.random().toString(16).slice(2, 10);

    const pollUrl = `${BASE_URL}/socket.io/?EIO=4&transport=polling&t=${t}`;
    const pollResp = await fetch(pollUrl, {
      headers: { 'user-agent': HEADERS['user-agent'] },
    });
    const pollText = await pollResp.text();

    const handshake = parseEngineIO(pollText);
    this.sid = handshake.sid;

    const setCookies = pollResp.headers.getSetCookie?.() ?? [];
    this.cookies = setCookies.map(c => c.split(';')[0]).join('; ');

    const t2 = Math.random().toString(16).slice(2, 10);
    const authUrl = `${BASE_URL}/socket.io/?EIO=4&transport=polling&t=${t2}&sid=${this.sid}`;
    const authResp = await fetch(authUrl, {
      method: 'POST',
      body: '40{"jwt":"anonymous-ask-user"}',
      headers: {
        'content-type': 'text/plain',
        'user-agent': HEADERS['user-agent'],
        'cookie': this.cookies,
      },
    });
    const authText = await authResp.text();
    if (authResp.status !== 200) throw new Error('Auth failed: ' + authText);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(
        `wss://www.perplexity.ai/socket.io/?EIO=4&transport=websocket&sid=${this.sid}`,
        { headers: { 'User-Agent': HEADERS['user-agent'], Cookie: this.cookies } }
      );

      this.ws.on('open', () => {
        this.ws.send('2probe');
        this.ws.send('5');
        resolve();
      });

      this.ws.on('message', (raw) => {
        const msg = raw.toString();
        if (msg === '2') { this.ws.send('3'); return; }
        if (msg === '3probe') return;
        if (msg.startsWith('42')) {
          try {
            const parsed = JSON.parse(msg.slice(2));
            if (Array.isArray(parsed) && parsed.length >= 2) {
              this._pushMessage(parsed[1]);
            }
          } catch (e) {
            if (process.env.PPLX_VERBOSE) console.error('WS parse error:', e.message);
          }
        }
      });

      this.ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
    });
  }

  async* ask(query, model = 'sonar') {
    this.history.push({ role: 'user', content: query });

    this.ws.send('42' + JSON.stringify([
      'perplexity_labs',
      {
        messages: this.history,
        model,
        source: 'default',
        version: '2.18',
      },
    ]));

    while (true) {
      const data = await this._nextMessage();
      yield data;
      if (data.final) {
        this.history.push({ role: 'assistant', content: data.output, priority: 0 });
        return;
      }
    }
  }

  close() {
    this.ws?.close();
  }
}
