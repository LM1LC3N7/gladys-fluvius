// -----------------------------------------------------------------------------
// Fake `fetch` for the Mijn Fluvius calls: routes by host and path, records
// every call, fails loudly on an unexpected one. No test touches the network.
// -----------------------------------------------------------------------------

import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const html = (body, status = 200, cookies = []) =>
  new Response(body, {
    status,
    headers: [['content-type', 'text/html'], ...cookies.map((c) => ['set-cookie', c])],
  });

export const redirect = (location, status = 302, cookies = []) =>
  new Response(null, {
    status,
    headers: [['location', location], ...cookies.map((c) => ['set-cookie', c])],
  });

/** The name of a call. */
export function routeName(parsed) {
  const { hostname, pathname } = parsed;
  if (hostname === 'mijn.fluvius.be') {
    if (pathname === '/api/global/msal/config') return 'msal';
    if (pathname.startsWith('/verbruik/api/meter-measurement-history/')) return 'history';
    if (pathname.startsWith('/verbruik/api/meter-measurement-spikes/')) return 'spikes';
  }
  if (hostname === 'login.fluvius.be') {
    if (pathname.endsWith('/oauth2/v2.0/authorize')) return 'authorize';
    if (pathname.endsWith('/oauth2/v2.0/token')) return 'token';
    if (pathname.endsWith('/SelfAsserted')) return 'selfAsserted';
    if (pathname.endsWith('/confirmed')) return 'confirmed';
  }
  return 'unknown';
}

/** `routes` maps a call name to handler(call) -> Response. */
export function installFetch(routes) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const parsed = new URL(url);
    const body = typeof init.body === 'string' ? init.body : undefined;
    const call = {
      url,
      name: routeName(parsed),
      method: init.method ?? 'GET',
      host: parsed.hostname,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      headers: init.headers ?? {},
      redirect: init.redirect,
      body,
      form: body ? Object.fromEntries(new URLSearchParams(body)) : undefined,
    };
    calls.push(call);
    const handler = routes[call.name];
    if (!handler) {
      throw new Error(
        `Unexpected Fluvius call in a test: ${call.name} ${parsed.host}${parsed.pathname}`,
      );
    }
    return handler(call);
  });
  return {
    calls,
    named: (name) => calls.filter((c) => c.name === name),
    restore: () => setFetch(previous),
  };
}
