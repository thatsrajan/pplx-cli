/**
 * HTTP layer with curl-impersonate fallback for TLS fingerprinting (REVIEW issue #1)
 */
import { execSync } from 'child_process';
import { HEADERS } from './constants.js';

let useCurl = false;
let curlBinary = null;

export function setUseCurl(val) { useCurl = val; }
export function getUseCurl() { return useCurl; }

function findCurlImpersonate() {
  if (curlBinary !== null) return curlBinary;
  for (const name of ['curl-impersonate-chrome', 'curl_chrome116', 'curl_chrome120']) {
    try {
      execSync(`which ${name}`, { stdio: 'pipe' });
      curlBinary = name;
      return curlBinary;
    } catch {}
  }
  curlBinary = false;
  return false;
}

/**
 * Make a request, with curl-impersonate fallback.
 * Returns { status, headers, text(), json(), body (readable stream or null) }
 */
export async function request(url, opts = {}) {
  if (!useCurl) {
    return fetch(url, opts);
  }

  // curl-impersonate fallback
  const bin = findCurlImpersonate();
  if (!bin) {
    console.error('curl-impersonate not found. Install: brew install nicholasgasior/tap/curl-impersonate');
    console.error('Falling back to native fetch...');
    return fetch(url, opts);
  }

  const args = [bin, '-s', '-S', '-D', '-'];
  if (opts.method) args.push('-X', opts.method);
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      args.push('-H', `${k}: ${v}`);
    }
  }
  if (opts.body) args.push('-d', typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  if (opts.redirect === 'manual') args.push('-L');
  args.push(url);

  const result = execSync(args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' '), {
    encoding: 'buffer',
    maxBuffer: 10 * 1024 * 1024,
  });

  const text = result.toString('utf-8');
  const headerEnd = text.indexOf('\r\n\r\n');
  const headerPart = text.slice(0, headerEnd);
  const bodyPart = text.slice(headerEnd + 4);

  const statusLine = headerPart.split('\r\n')[0];
  const status = parseInt(statusLine.split(' ')[1]);

  const headers = new Map();
  for (const line of headerPart.split('\r\n').slice(1)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      headers.set(line.slice(0, idx).toLowerCase().trim(), line.slice(idx + 1).trim());
    }
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => headers.get(k.toLowerCase()) ?? null,
      getSetCookie: () => {
        // Collect all set-cookie headers
        const cookies = [];
        for (const line of headerPart.split('\r\n').slice(1)) {
          const idx = line.indexOf(':');
          if (idx > 0 && line.slice(0, idx).toLowerCase().trim() === 'set-cookie') {
            cookies.push(line.slice(idx + 1).trim());
          }
        }
        return cookies;
      },
    },
    text: async () => bodyPart,
    json: async () => JSON.parse(bodyPart),
    body: null, // no streaming with curl fallback
  };
}

/**
 * Streaming fetch — always uses native fetch (curl can't stream).
 * If TLS is blocked, we need curl-impersonate installed as a library, not CLI.
 */
export async function streamingFetch(url, opts) {
  return fetch(url, opts);
}
