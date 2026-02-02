import WebSocket from 'ws';
import { HEADERS, BASE_URL } from './constants.js';

export class LabsClient {
  constructor() {
    this.ws = null;
    this.sid = null;
    this.history = [];
    this.resolveMessage = null;
    this.cookies = '';
  }

  async connect() {
    const t = Math.random().toString(16).slice(2, 10);

    // Step 1: Polling handshake (REVIEW issue #3: handle length-prefixed format)
    const pollUrl = `${BASE_URL}/socket.io/?EIO=4&transport=polling&t=${t}`;
    const pollResp = await fetch(pollUrl, {
      headers: { 'user-agent': HEADERS['user-agent'] },
    });
    const pollText = await pollResp.text();

    // Find first '{' to handle length prefix
    const braceIdx = pollText.indexOf('{');
    if (braceIdx === -1) throw new Error('Invalid polling response: ' + pollText.slice(0, 200));
    const handshake = JSON.parse(pollText.slice(braceIdx));
    this.sid = handshake.sid;

    // Collect cookies (REVIEW issue #4: use getSetCookie array)
    const setCookies = pollResp.headers.getSetCookie?.() ?? [];
    this.cookies = setCookies.map(c => c.split(';')[0]).join('; ');

    // Step 2: Auth via polling
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

    // Step 3: WebSocket upgrade
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
        if (msg === '3probe') return; // probe response
        if (msg.startsWith('42')) {
          try {
            const parsed = JSON.parse(msg.slice(2));
            if (Array.isArray(parsed) && parsed.length >= 2) {
              this.resolveMessage?.(parsed[1]);
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
      const data = await new Promise(r => { this.resolveMessage = r; });
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
