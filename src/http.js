// -----------------------------------------------------------------------------
// The only place that talks HTTP: one request with a timeout, a browser
// User-Agent, the cookies of the login (a tiny cookie jar), redirects never
// followed blindly, and a bounded body. The tests replace `fetch` with
// `setFetch()`.
//
// Never put a URL, a body or a header in an error message: the e-mail, the
// password, the authorization code and the tokens travel there.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/**
 * Codes: network | timeout | too_large | http (5xx, others) | rate_limited |
 * unauthorized (401 on a data call) | forbidden (403) | not_found (404) |
 * bad_request (400) | bad_credentials | interaction_required |
 * login_changed | token_refused | no_credentials.
 */
export class FluviusError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'FluviusError';
    this.code = code;
    this.status = status;
  }
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or invalid. */
export function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/**
 * The hosts the integration talks to: Fluvius and its Azure AD B2C tenant.
 * A login page or a redirect pointing anywhere else is refused, so the
 * password never leaves them.
 */
export function isAllowedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return (
    parsed.protocol === 'https:' &&
    (host === 'fluvius.be' || host.endsWith('.fluvius.be') || host.endsWith('.b2clogin.com'))
  );
}

/** Cookies by name, per host, as a browser keeps them for the login pages. */
export class CookieJar {
  constructor() {
    this.cookies = [];
  }

  /** Store the Set-Cookie headers of a response to `url`. */
  store(url, headers) {
    const host = new URL(url).hostname.toLowerCase();
    const lines =
      typeof headers?.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers?.get?.('set-cookie')].filter(Boolean);
    for (const line of lines.slice(0, 50)) {
      const [pair, ...attributes] = String(line).split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = host;
      let hostOnly = true;
      let expired = false;
      let foreign = false;
      for (const attribute of attributes) {
        const [key, ...rest] = attribute.split('=');
        const k = key.trim().toLowerCase();
        const v = rest.join('=').trim();
        if (k === 'domain' && v) {
          const d = v.replace(/^\./, '').toLowerCase();
          // A cookie for another site is dropped, like a browser does.
          if (host === d || host.endsWith(`.${d}`)) {
            domain = d;
            hostOnly = false;
          } else {
            foreign = true;
          }
        } else if (k === 'max-age' && Number(v) <= 0) {
          expired = true;
        } else if (k === 'expires' && Date.parse(v) < Date.now()) {
          expired = true;
        }
      }
      if (foreign) {
        continue;
      }
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain));
      if (!expired) {
        this.cookies.push({ name, value, domain, hostOnly });
      }
    }
  }

  /** The Cookie header for a request to `url` ('' when none). */
  header(url) {
    const host = new URL(url).hostname.toLowerCase();
    return this.cookies
      .filter((c) => host === c.domain || (!c.hostOnly && host.endsWith(`.${c.domain}`)))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }
}

/** Read at most `max` bytes of a body; more is refused (a hostile or broken answer). */
async function readBody(response, max) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > max) {
      throw new FluviusError('too_large', 'Fluvius answered too much data');
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new FluviusError('too_large', 'Fluvius answered too much data');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * One request, redirects NOT followed (the caller decides). Resolves
 * `{ status, headers, text, location }`, `location` absolute. Throws a
 * FluviusError on a network failure, a timeout, a 429 or a body too large.
 */
export async function send(url, { method = 'GET', headers = {}, body, jar } = {}) {
  if (!isAllowedUrl(url)) {
    throw new FluviusError('login_changed', 'Fluvius pointed to an unexpected address');
  }
  const all = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8',
    ...headers,
  };
  const cookie = jar?.header(url);
  if (cookie) {
    all.Cookie = cookie;
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: all,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new FluviusError(timeout ? 'timeout' : 'network', timeout ? 'timeout' : 'network error');
  }
  jar?.store(url, response.headers);
  if (response.status === 429) {
    await response.body?.cancel?.().catch(() => {});
    const error = new FluviusError('rate_limited', 'Fluvius asked to slow down (429)', 429);
    error.retryAfter = retryAfterMs(response.headers?.get?.('retry-after'));
    throw error;
  }
  const text = await readBody(response, MAX_BODY_BYTES);
  const raw = response.headers?.get?.('location');
  let location;
  if (raw) {
    try {
      location = new URL(raw, url).href;
    } catch {
      location = undefined;
    }
  }
  return { status: response.status, headers: response.headers, text, location };
}

export const isRedirect = (status) => [301, 302, 303, 307, 308].includes(status);

/** Parse a JSON text; undefined when it is not JSON. */
export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The error of a data call (Bearer GET) answering `status`. */
export function dataError(status) {
  if (status === 401) {
    return new FluviusError('unauthorized', 'Fluvius refused the access token (401)', 401);
  }
  if (status === 403) {
    return new FluviusError('forbidden', 'Fluvius refused access to this meter (403)', 403);
  }
  if (status === 404) {
    return new FluviusError('not_found', 'Fluvius does not know this meter (404)', 404);
  }
  if (status === 400) {
    return new FluviusError('bad_request', 'Fluvius refused the request (400)', 400);
  }
  return new FluviusError('http', `Fluvius answered ${status}`, status);
}
