import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { setUseCurl, streamingFetch } from '../src/http.js';

function hasCurlImpersonate() {
  try {
    execSync('which curl_chrome120', { stdio: 'ignore' });
    return true;
  } catch {}
  try {
    execSync('which curl_chrome116', { stdio: 'ignore' });
    return true;
  } catch {}
  return false;
}

const shouldSkip = !process.env.PPLX_RUN_CURL_STREAM_TEST || !hasCurlImpersonate();

describe('curl streamingFetch (integration)', () => {
  it('streams SSE responses when curl-impersonate is enabled', { skip: shouldSkip }, async () => {
    const server = createServer((req, res) => {
      if (req.url !== '/sse') {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      });
      res.write('data: {"answer":"hello"}\n\n');
      setTimeout(() => {
        res.write('data: {"final_sse_message":true}\n\n');
        res.end();
      }, 10);
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/sse`;

    setUseCurl(true);
    try {
      const resp = await streamingFetch(url, {
        headers: { accept: 'text/event-stream' },
        timeout: 10000,
      });
      assert.equal(resp.status, 200);
      assert.equal(resp.headers.get('content-type'), 'text/event-stream');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.includes('final_sse_message')) break;
      }
      text += decoder.decode();
      assert.match(text, /data: .*answer/);
    } finally {
      setUseCurl(false);
      server.close();
    }
  });
});
