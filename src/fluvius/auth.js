// -----------------------------------------------------------------------------
// The Mijn Fluvius sign-in: the Azure AD B2C "authorization code + PKCE" flow
// a browser goes through, driven over HTTP only (no browser, no script). Ported
// from sander110419/Fluvius-home-assistant (MIT, custom_components/fluvius/
// auth.py):
//   1. the MSAL settings of mijn.fluvius.be (client id, authority, scopes);
//   2. the B2C authorize page, which holds the SETTINGS (csrf, transaction)
//      and SA_FIELDS (the ids of the e-mail and password fields) objects;
//   3. the e-mail and password posted to the SelfAsserted endpoint;
//   4. CombinedSigninAndSignup/confirmed, whose redirects carry the code;
//   5. the code exchanged for an access token.
// A login that stops at step 4 on a page instead of a redirect asks for
// something only a browser can do (a second factor, new terms, a password
// change): `interaction_required`.
//
// Every URL comes from Fluvius' answers but must stay on Fluvius or its B2C
// tenant (http.js `isAllowedUrl`): the password is never posted elsewhere.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_AUTHORITY,
  DEFAULT_REDIRECT_URI,
  DEFAULT_SCOPE,
  MAX_REDIRECTS,
  MSAL_CONFIG_URL,
} from '../constants.js';
import { CookieJar, FluviusError, isAllowedUrl, isRedirect, parseJson, send } from '../http.js';

const base64url = (buffer) => buffer.toString('base64url');

export function pkcePair(random = randomBytes) {
  const verifier = base64url(random(64));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const changed = (what) => new FluviusError('login_changed', `The Fluvius login changed (${what})`);

const MAX_OCCURRENCES = 20;

/**
 * The JSON object assigned to `var <name> = {...};` in the B2C page: from
 * `{` to the first `};` after it (what the reference's lazy regular
 * expression matches), found with `indexOf` only. Every occurrence of the
 * name is tried (a comment or another script may mention it first), at most
 * MAX_OCCURRENCES, so a hostile page stays cheap.
 */
export function extractJsonVariable(name, html) {
  const marker = `var ${name}`;
  let found = false;
  for (
    let at = html.indexOf(marker), n = 0;
    at >= 0 && n < MAX_OCCURRENCES;
    at = html.indexOf(marker, at + marker.length), n += 1
  ) {
    let i = at + marker.length;
    // `var SETTINGS_X`: another name.
    if (/[\w$]/.test(html[i] ?? '')) continue;
    while (i < html.length && /\s/.test(html[i])) i += 1;
    if (html[i] !== '=') continue;
    i += 1;
    while (i < html.length && /\s/.test(html[i])) i += 1;
    if (html[i] !== '{') continue;
    const end = html.indexOf('};', i);
    if (end < 0) break;
    found = true;
    const value = parseJson(html.slice(i, end + 1));
    if (value && typeof value === 'object') {
      return value;
    }
  }
  throw changed(found ? `${name} is not JSON` : `no ${name}`);
}

/** The scopes asked: those of the MSAL settings, plus openid, offline_access and the API's. */
export function scopesOf(metadata = {}) {
  const found = [];
  const add = (list) => {
    for (const scope of list) {
      if (typeof scope === 'string' && scope && !found.includes(scope)) {
        found.push(scope);
      }
    }
  };
  const candidates = [
    metadata.scopes,
    metadata.defaultScopes,
    metadata.apiScopes,
    metadata.authRequest?.scopes,
    metadata.protectedResourceMap,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') {
      add(candidate.split(/\s+/));
    } else if (Array.isArray(candidate)) {
      add(candidate);
    } else if (typeof candidate === 'object') {
      for (const value of Object.values(candidate)) {
        if (Array.isArray(value)) add(value);
        else if (typeof value === 'string') add(value.split(/\s+/));
      }
    }
  }
  add(['openid', 'offline_access', DEFAULT_SCOPE]);
  return found.join(' ');
}

/** client id, authority, redirect URI and scopes from the MSAL settings. */
export function msalSettings(metadata = {}) {
  const auth = metadata.auth ?? {};
  const clientId = metadata.clientId ?? auth.clientId;
  if (typeof clientId !== 'string' || !clientId) {
    throw changed('no client id');
  }
  const authority = String(metadata.authority ?? auth.authority ?? DEFAULT_AUTHORITY).replace(
    /\/+$/,
    '',
  );
  if (!isAllowedUrl(authority)) {
    throw changed('unexpected authority');
  }
  let redirectUri = metadata.redirectUri ?? auth.redirectUri ?? DEFAULT_REDIRECT_URI;
  if (typeof redirectUri !== 'string' || !isAllowedUrl(redirectUri)) {
    redirectUri = DEFAULT_REDIRECT_URI;
  }
  return { clientId, authority, redirectUri, scopes: scopesOf(metadata) };
}

/** GET a URL, following at most MAX_REDIRECTS redirects on the allowed hosts. */
async function getFollowing(url, jar) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await send(current, {
      jar,
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    if (!isRedirect(response.status)) {
      return { ...response, url: current };
    }
    if (!response.location) {
      throw changed('redirect without a location');
    }
    current = response.location;
  }
  throw changed('too many redirects');
}

// A 5xx, a 403 (a proxy or firewall in front of Fluvius) or a 408 is a
// passing failure (normal backoff), not a changed login.
const httpFailure = (status, step) =>
  status >= 500 || status === 403 || status === 408
    ? new FluviusError('http', `Fluvius answered ${status} (${step})`, status)
    : changed(`${step} answered ${status}`);

/**
 * Sign in with the e-mail and the password. Resolves the token answer
 * (`access_token`, `expires_in`...). Throws a FluviusError: bad_credentials,
 * interaction_required, login_changed, or a passing error.
 */
export async function authenticate(email, password, { random = randomBytes } = {}) {
  if (!email || !password) {
    throw new FluviusError('no_credentials', 'No Fluvius e-mail or password configured');
  }
  const jar = new CookieJar();

  // 1. MSAL settings of the Mijn Fluvius web app.
  const config = await send(MSAL_CONFIG_URL, { jar, headers: { Accept: 'application/json' } });
  if (config.status !== 200) {
    throw httpFailure(config.status, 'settings');
  }
  const metadata = parseJson(config.text);
  if (!metadata || typeof metadata !== 'object') {
    throw changed('settings are not JSON');
  }
  const { clientId, authority, redirectUri, scopes } = msalSettings(metadata);

  // 2. The authorize page.
  const pkce = pkcePair(random);
  const state = base64url(random(24));
  const nonce = base64url(random(24));
  const authorize = new URL(`${authority}/oauth2/v2.0/authorize`);
  for (const [key, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    prompt: 'login',
    client_info: '1',
    login_hint: email,
  })) {
    authorize.searchParams.set(key, value);
  }
  const page = await getFollowing(authorize.href, jar);
  if (page.status !== 200) {
    throw httpFailure(page.status, 'login page');
  }
  const settings = extractJsonVariable('SETTINGS', page.text);
  const fields = extractJsonVariable('SA_FIELDS', page.text);
  const attributes = Array.isArray(fields.AttributeFields) ? fields.AttributeFields : [];
  const loginField = attributes[0]?.ID;
  const passwordField = attributes.find((a) => a?.IS_PASSWORD)?.ID;
  if (typeof loginField !== 'string' || typeof passwordField !== 'string') {
    throw changed('no e-mail or password field');
  }
  const { csrf, transId } = settings;
  const policy = settings.hosts?.policy;
  const tenant = settings.hosts?.tenant;
  if (![csrf, transId, policy, tenant].every((v) => typeof v === 'string' && v)) {
    throw changed('incomplete settings');
  }
  const origin = new URL(page.url).origin;
  const tenantBase = (
    /^https?:/i.test(tenant) ? tenant : new URL(tenant.replace(/^\/+/, ''), `${origin}/`).href
  ).replace(/\/+$/, '');
  // The password is posted only to the host of the authority or to Fluvius.
  const tenantHost = isAllowedUrl(tenantBase) ? new URL(tenantBase).hostname.toLowerCase() : '';
  if (
    !tenantHost ||
    !(
      tenantHost === new URL(authority).hostname.toLowerCase() ||
      tenantHost === 'fluvius.be' ||
      tenantHost.endsWith('.fluvius.be')
    )
  ) {
    throw changed('unexpected tenant');
  }

  // 3. The credentials.
  const submit = new URL(`${tenantBase}/SelfAsserted`);
  submit.searchParams.set('tx', transId);
  submit.searchParams.set('p', policy);
  const asserted = await send(submit.href, {
    method: 'POST',
    jar,
    headers: {
      'X-CSRF-TOKEN': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: new URL(tenantBase).origin,
      Referer: tenantBase,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: new URLSearchParams({
      request_type: 'RESPONSE',
      [loginField]: email,
      [passwordField]: password,
    }).toString(),
  });
  if (asserted.status >= 500) {
    throw httpFailure(asserted.status, 'credentials');
  }
  const answer = parseJson(asserted.text);
  const status = String(answer?.status ?? '');
  if (asserted.status !== 200 || !answer) {
    throw changed(`credentials answered ${asserted.status}`);
  }
  if (status !== '200' && status !== 'success') {
    // B2C answers { status: "400", message } to a wrong e-mail or password.
    throw new FluviusError('bad_credentials', 'Fluvius refused the e-mail or the password');
  }

  // 4. The confirmation, whose redirects carry the authorization code.
  const api = String(settings.api ?? 'CombinedSigninAndSignup').replace(/^\/+|\/+$/g, '');
  const confirm = new URL(`${tenantBase}/api/${api}/confirmed`);
  confirm.searchParams.set('rememberMe', 'false');
  confirm.searchParams.set('csrf_token', csrf);
  confirm.searchParams.set('tx', transId);
  confirm.searchParams.set('p', policy);
  let next = confirm.href;
  let code;
  for (let hop = 0; hop <= MAX_REDIRECTS && !code; hop += 1) {
    const response = await send(next, { jar, headers: { Accept: 'text/html' } });
    if (!isRedirect(response.status) || !response.location) {
      if (response.status >= 500) {
        throw httpFailure(response.status, 'confirmation');
      }
      // A page instead of a redirect: a second factor, new terms, a password
      // change... only a browser can go on.
      throw new FluviusError(
        'interaction_required',
        'The Fluvius login asks for a step only a browser can do (second factor, terms, password change)',
      );
    }
    const target = new URL(response.location);
    if (target.searchParams.has('error')) {
      throw new FluviusError(
        'interaction_required',
        'The Fluvius login refused to go on without a browser',
      );
    }
    if (target.searchParams.has('code')) {
      const returned = target.searchParams.get('state');
      if (returned && returned !== state) {
        throw changed('state mismatch');
      }
      code = target.searchParams.get('code');
    } else {
      next = target.href;
    }
  }
  if (!code) {
    throw changed('no authorization code');
  }

  // 5. The tokens.
  const token = await send(`${authority}/oauth2/v2.0/token`, {
    method: 'POST',
    jar,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: scopes,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: pkce.verifier,
    }).toString(),
  });
  if (token.status !== 200) {
    throw httpFailure(token.status, 'token');
  }
  const tokens = parseJson(token.text);
  if (typeof tokens?.access_token !== 'string' || !tokens.access_token) {
    throw changed('no access token');
  }
  return tokens;
}
