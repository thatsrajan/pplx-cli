/**
 * HTTP layer with curl-impersonate fallback for TLS fingerprinting (REVIEW issue #1)
 */
import { execSync, spawn } from 'child_process';
import { PassThrough, Readable } from 'stream';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { withRetry } from './retry.js';

let useCurl = false;
let curlBinary = null;
let warnedNoCurl = false;

const CURL_IMPERSONATE_VERSION = 'v0.6.1';
const CURL_IMPERSONATE_BASE = `https://github.com/lwthiker/curl-impersonate/releases/download/${CURL_IMPERSONATE_VERSION}`;
const CURL_CACHE_DIR = join(homedir(), '.cache', 'pplx', 'curl-impersonate', CURL_IMPERSONATE_VERSION);
const CURL_CANDIDATES = [
  'curl-impersonate-chrome',
  'curl_chrome120',
  'curl_chrome116',
  'curl_chrome110',
  'curl_chrome107',
  'curl_chrome104',
  'curl_chrome101',
  'curl_chrome100',
  'curl_chrome99',
];

export function setUseCurl(val) { useCurl = val; }
export function getUseCurl() { return useCurl; }

function resolveCurlAsset() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'linux') {
    if (arch === 'x64') return `curl-impersonate-${CURL_IMPERSONATE_VERSION}.x86_64-linux-gnu.tar.gz`;
    if (arch === 'arm64') return `curl-impersonate-${CURL_IMPERSONATE_VERSION}.aarch64-linux-gnu.tar.gz`;
    if (arch === 'arm') return `curl-impersonate-${CURL_IMPERSONATE_VERSION}.arm-linux-gnueabihf.tar.gz`;
  }
  if (platform === 'darwin') {
    if (arch === 'x64') return `curl-impersonate-${CURL_IMPERSONATE_VERSION}.x86_64-macos.tar.gz`;
    if (arch === 'arm64') return `curl-impersonate-${CURL_IMPERSONATE_VERSION}.x86_64-macos.tar.gz`;
  }
  return null;
}

function findBinaryInDir(dir) {
  for (const name of CURL_CANDIDATES) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('curl_chrome') || entry.name.startsWith('curl-impersonate')) {
        return join(dir, entry.name);
      }
    }
  } catch {}
  return null;
}

function downloadCurlImpersonate() {
  const asset = resolveCurlAsset();
  if (!asset) return false;

  const binPath = join(CURL_CACHE_DIR, 'curl-impersonate-chrome');
  if (existsSync(binPath)) return binPath;

  const url = `${CURL_IMPERSONATE_BASE}/${asset}`;
  const tmpDir = join(CURL_CACHE_DIR, `tmp-${Date.now()}`);
  try {
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(CURL_CACHE_DIR, { recursive: true });
    const tgz = join(tmpDir, asset);
    execSync(`curl -L -o '${tgz}' '${url}'`, { stdio: 'ignore' });
    execSync(`tar -xzf '${tgz}' -C '${tmpDir}'`, { stdio: 'ignore' });
    const found = findBinaryInDir(tmpDir);
    if (!found) return false;
    copyFileSync(found, binPath);
    chmodSync(binPath, 0o755);
    return binPath;
  } catch {
    return false;
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function findCurlImpersonate() {
  if (curlBinary !== null) return curlBinary;
  const envPath = process.env.PPLX_CURL_IMPERSONATE;
  if (envPath && existsSync(envPath)) {
    curlBinary = envPath;
    return curlBinary;
  }
  for (const name of ['curl-impersonate-chrome', 'curl_chrome116', 'curl_chrome120']) {
    try {
      execSync(`which ${name}`, { stdio: 'pipe' });
      curlBinary = name;
      return curlBinary;
    } catch {}
  }
  const downloaded = downloadCurlImpersonate();
  if (downloaded) {
    curlBinary = downloaded;
    return curlBinary;
  }
  curlBinary = false;
  return false;
}

function parseHeaderBlock(headerBlock) {
  const lines = headerBlock.split('\r\n');
  const statusLine = lines.shift() || '';
  const status = parseInt(statusLine.split(' ')[1] ?? '0', 10);
  const headers = new Map();
  const setCookies = [];
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).toLowerCase().trim();
      const val = line.slice(idx + 1).trim();
      headers.set(key, val);
      if (key === 'set-cookie') setCookies.push(val);
    }
  }
  return { status, headers, setCookies };
}

/**
 * Make a request, with curl-impersonate fallback.
 * Returns { status, headers, text(), json(), body (readable stream or null) }
 */
export async function request(url, opts = {}) {
  if (!useCurl) {
    return withRetry(() => fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(opts.timeout ?? 30000) }));
  }

  // curl-impersonate fallback
  const bin = findCurlImpersonate();
  if (!bin) {
    if (!warnedNoCurl) {
      warnedNoCurl = true;
      console.error('curl-impersonate not found.');
      console.error('  Install: brew install nicholasgasior/tap/curl-impersonate');
      console.error('  Or set PPLX_CURL_IMPERSONATE=/path/to/curl-impersonate-chrome');
      console.error('  Falling back to native fetch...');
    }
    return fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(opts.timeout ?? 30000) });
  }

  const args = [bin, '-s', '-S', '-D', '-'];
  if (opts.method) args.push('-X', opts.method);
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      args.push('-H', `${k}: ${v}`);
    }
  }
  if (opts.body) args.push('-d', typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  if (opts.redirect !== 'manual') args.push('-L');
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

// Proxy support: For curl path, HTTPS_PROXY/HTTP_PROXY env vars are respected automatically.
// For native fetch, Node 20+ doesn't natively support proxies. Use --curl with proxy env vars,
// or set HTTPS_PROXY and run with: node --experimental-fetch bin/pplx.js

/**
 * Streaming fetch — uses curl-impersonate when enabled to preserve TLS fingerprint.
 * Falls back to native fetch if curl-impersonate is unavailable.
 */
export async function streamingFetch(url, opts) {
  if (!useCurl) {
    return fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(opts.timeout ?? 120000) });
  }

  const bin = findCurlImpersonate();
  if (!bin) {
    if (!warnedNoCurl) {
      warnedNoCurl = true;
      console.error('curl-impersonate not found.');
      console.error('  Install: brew install nicholasgasior/tap/curl-impersonate');
      console.error('  Or set PPLX_CURL_IMPERSONATE=/path/to/curl-impersonate-chrome');
      console.error('  Falling back to native fetch...');
    }
    return fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(opts.timeout ?? 120000) });
  }

  const args = ['-s', '-S', '-D', '-', '--no-buffer'];
  if (opts.method) args.push('-X', opts.method);
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      args.push('-H', `${k}: ${v}`);
    }
  }
  if (opts.body) {
    args.push('-d', typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  }
  if (opts.redirect !== 'manual') args.push('-L');
  args.push(url);

  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const bodyStream = new PassThrough();
  const bodyBuffers = [];
  let buffer = Buffer.alloc(0);
  let status = 0;
  let headers = new Map();
  let setCookies = [];
  let resolved = false;
  let stderr = '';
  let parsingHeaders = true;

  const timeoutMs = opts.timeout ?? 120000;
  const timeoutId = timeoutMs ? setTimeout(() => child.kill('SIGTERM'), timeoutMs) : null;

  const abortSignal = opts.signal;
  if (abortSignal) {
    if (abortSignal.aborted) child.kill('SIGTERM');
    abortSignal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
  }

  const shouldWaitForNext = (code) => {
    if (code >= 100 && code < 200) return true;
    if (opts.redirect !== 'manual' && code >= 300 && code < 400) return true;
    return false;
  };

  function resolveResponse() {
    if (resolved) return;
    resolved = true;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (k) => headers.get(k.toLowerCase()) ?? null,
        getSetCookie: () => setCookies.slice(),
      },
      text: async () => Buffer.concat(bodyBuffers).toString('utf-8'),
      json: async () => JSON.parse(Buffer.concat(bodyBuffers).toString('utf-8')),
      body: Readable.toWeb(bodyStream),
    };
  }

  const responsePromise = new Promise((resolve, reject) => {
    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      bodyStream.end();
      if (!resolved) {
        if (code === 0 && status) {
          resolve(resolveResponse());
          return;
        }
        const msg = stderr.trim() || `curl exited with code ${code}`;
        reject(new Error(msg));
        return;
      }
      if (code !== 0 && stderr.trim()) {
        console.error(stderr.trim());
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });

    child.stdout.on('data', (chunk) => {
      if (!parsingHeaders) {
        bodyBuffers.push(chunk);
        bodyStream.write(chunk);
        return;
      }

      buffer = Buffer.concat([buffer, chunk]);
      while (parsingHeaders) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const headerBlock = buffer.slice(0, headerEnd).toString('utf-8');
        buffer = buffer.slice(headerEnd + 4);

        if (!headerBlock.startsWith('HTTP/')) {
          bodyBuffers.push(Buffer.from(headerBlock, 'utf-8'));
          bodyStream.write(headerBlock);
          continue;
        }

        const parsed = parseHeaderBlock(headerBlock);
        status = parsed.status;
        headers = parsed.headers;
        setCookies = parsed.setCookies;

        if (shouldWaitForNext(status)) {
          continue;
        }

        const resp = resolveResponse();
        if (resp) resolve(resp);
        parsingHeaders = false;

        if (buffer.length > 0) {
          bodyBuffers.push(buffer);
          bodyStream.write(buffer);
          buffer = Buffer.alloc(0);
        }
      }
    });
  });

  return responsePromise;
}
