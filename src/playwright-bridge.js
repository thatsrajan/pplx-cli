import { chromium } from 'playwright';
import { BASE_URL, HEADERS } from './constants.js';

function toPlaywrightCookies(cookies) {
  return Object.entries(cookies || {}).map(([name, value]) => ({
    name,
    value: String(value),
    domain: '.perplexity.ai',
    path: '/',
    secure: name.startsWith('__Secure-') || name.startsWith('__Host-'),
    httpOnly: false,
    sameSite: 'Lax',
  }));
}

export class PlaywrightBridge {
  constructor(opts = {}) {
    this.headless = opts.headless !== false;
    this.cookies = opts.cookies || {};
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async connect() {
    this.browser = await chromium.launch({ headless: this.headless });
    this.context = await this.browser.newContext({
      userAgent: HEADERS['user-agent'],
    });

    const pwCookies = toPlaywrightCookies(this.cookies);
    if (pwCookies.length > 0) {
      await this.context.addCookies(pwCookies);
    }

    this.page = await this.context.newPage();
    await this.page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  }

  async evaluate(expression) {
    return this.page.evaluate((expr) => eval(expr), expression);
  }

  /**
   * Execute a streaming fetch — stores chunks in the page, polls them back.
   * Returns an async generator of SSE text chunks.
   */
  async *fetchSSE(url, fetchOpts = {}) {
    const storeId = '_pplx_' + Date.now();

    await this.evaluate(`
      (async () => {
        window.${storeId} = { chunks: [], done: false, error: null, status: 0 };
        try {
          const r = await fetch(${JSON.stringify(url)}, ${JSON.stringify({
            ...fetchOpts,
            credentials: 'include',
          })});
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
    `);

    const deadline = Date.now() + (fetchOpts.timeout ?? 120000);
    await new Promise(r => setTimeout(r, 200));
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
        `);

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
      await this.evaluate(`delete window['${storeId}']`).catch(() => {});
    }
  }

  async close() {
    try { await this.context?.close(); } catch {}
    try { await this.browser?.close(); } catch {}
  }
}
