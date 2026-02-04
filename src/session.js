import { HEADERS, BASE_URL } from './constants.js';
import { cookieHeader } from './cookies.js';
import { request } from './http.js';
import { withRetry } from './retry.js';

export async function initSession(cookies) {
  const resp = await withRetry(() => request(`${BASE_URL}/api/auth/session`, {
    headers: {
      ...HEADERS,
      cookie: cookieHeader(cookies),
    },
    redirect: 'manual',
  }));

  // Merge Set-Cookie headers (REVIEW issue #4: use getSetCookie array)
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      cookies[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }
  }

  return { cookies, status: resp.status, ok: resp.ok };
}

export async function testAuth(cookies) {
  const { status } = await initSession(cookies);
  return status === 200;
}
