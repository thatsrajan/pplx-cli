import { HEADERS, BASE_URL } from './constants.js';
import { cookieHeader } from './cookies.js';
import { request } from './http.js';
import { withRetry } from './retry.js';

function parseSessionPayload(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function isAuthenticatedSession(session) {
  return Boolean(
    session?.user?.email ||
    session?.user?.id ||
    session?.user?.name
  );
}

export async function initSession(cookies) {
  const resp = await withRetry(() => request(`${BASE_URL}/api/auth/session`, {
    headers: {
      ...HEADERS,
      accept: 'application/json',
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

  const text = await resp.text();
  const session = parseSessionPayload(text);

  return {
    cookies,
    status: resp.status,
    ok: resp.ok && isAuthenticatedSession(session),
    session,
  };
}

export async function testAuth(cookies) {
  const { ok } = await initSession(cookies);
  return ok;
}
