// -----------------------------------------------------------------------------
// The Mijn Fluvius sign-in (B2C flow) and client, against a fake fetch.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CREDENTIALS_RETRY,
  MAX_BODY_BYTES,
  RATE_LIMIT_MAX,
  RATE_LIMIT_MIN,
} from '../src/constants.js';
import { FluviusClient } from '../src/fluvius/api.js';
import { authenticate, extractJsonVariable, msalSettings, scopesOf } from '../src/fluvius/auth.js';
import { CookieJar, FluviusError, isAllowedUrl } from '../src/http.js';
import { html, installFetch, json, redirect } from './helpers/fakeFetch.js';
import {
  AUTHORITY,
  ELEC_EAN,
  ELEC_SERIAL,
  EMAIL,
  MSAL,
  NOW,
  PASSWORD,
  SA_FIELDS,
  SETTINGS,
  fluviusRoutes,
  loginPage,
} from './fixtures/fluvius.js';

let fake;
afterEach(() => fake?.restore());

const rejectsWith = (promise, code) =>
  assert.rejects(promise, (err) => err instanceof FluviusError && err.code === code);

test('the JSON objects of the B2C page are found without a regular expression', () => {
  const page = loginPage();
  assert.deepEqual(extractJsonVariable('SETTINGS', page), SETTINGS);
  assert.deepEqual(extractJsonVariable('SA_FIELDS', page), SA_FIELDS);
  assert.throws(() => extractJsonVariable('SETTINGS', '<html></html>'), /login changed/);
  assert.throws(() => extractJsonVariable('SETTINGS', 'var SETTINGS = {"a": };'), /not JSON/);
  // A huge hostile page is read once, linearly.
  const hostile = `var SETTINGS = {${'"a":1,'.repeat(200_000)}`;
  assert.throws(() => extractJsonVariable('SETTINGS', hostile), /login changed/);
});

test('the MSAL settings: scopes completed, foreign authority refused', () => {
  assert.equal(
    scopesOf(MSAL),
    'https://klanten.onmicrosoft.com/MijnFluvius/user_impersonation openid offline_access',
  );
  assert.equal(msalSettings(MSAL).authority, AUTHORITY);
  assert.throws(
    () => msalSettings({ clientId: 'x', authority: 'https://evil.example/b2c' }),
    /unexpected authority/,
  );
  assert.throws(() => msalSettings({}), /no client id/);
  assert.equal(
    msalSettings({ clientId: 'x', redirectUri: 'https://evil.example/' }).redirectUri,
    'https://mijn.fluvius.be/',
  );
  assert.ok(isAllowedUrl('https://login.fluvius.be/x'));
  assert.ok(!isAllowedUrl('http://login.fluvius.be/x'), 'never in clear text');
  assert.ok(!isAllowedUrl('https://fluvius.be.evil.example/'));
});

test('the cookie jar keeps the B2C cookies for their host only', () => {
  const jar = new CookieJar();
  jar.store(
    'https://login.fluvius.be/a',
    new Headers([
      ['set-cookie', 'a=1; domain=fluvius.be; path=/'],
      ['set-cookie', 'b=2; path=/'],
      ['set-cookie', 'c=3; domain=evil.example'],
      ['set-cookie', 'd=4; Max-Age=0'],
    ]),
  );
  assert.equal(jar.header('https://login.fluvius.be/x'), 'a=1; b=2');
  assert.equal(jar.header('https://mijn.fluvius.be/x'), 'a=1');
  assert.equal(jar.header('https://other.example/x'), '');
});

test('sign-in: the browser flow, PKCE, cookies, the password only to the B2C tenant', async () => {
  fake = installFetch(fluviusRoutes());
  const tokens = await authenticate(EMAIL, PASSWORD);
  assert.equal(tokens.access_token, 'acc-1');
  assert.deepEqual(
    fake.calls.map((c) => c.name),
    ['msal', 'authorize', 'selfAsserted', 'confirmed', 'token'],
  );
  assert.ok(
    fake.calls.every((c) => c.redirect === 'manual'),
    'redirects are never followed blindly',
  );
  const [, authorize, asserted, confirmed, token] = fake.calls;
  assert.equal(authorize.query.client_id, 'client-123');
  assert.equal(authorize.query.code_challenge_method, 'S256');
  assert.equal(authorize.query.login_hint, EMAIL);
  // The verifier sent with the code is the one of the challenge.
  assert.equal(
    createHash('sha256').update(token.form.code_verifier).digest('base64url'),
    authorize.query.code_challenge,
  );
  assert.equal(asserted.method, 'POST');
  assert.equal(
    asserted.path,
    '/klanten.onmicrosoft.com/B2C_1A_customer_signup_signin/SelfAsserted',
  );
  assert.deepEqual(asserted.query, { tx: SETTINGS.transId, p: SETTINGS.hosts.policy });
  assert.deepEqual(asserted.form, {
    request_type: 'RESPONSE',
    signInName: EMAIL,
    password: PASSWORD,
  });
  assert.equal(asserted.headers['X-CSRF-TOKEN'], SETTINGS.csrf);
  assert.equal(asserted.headers.Cookie, 'x-ms-cpim-csrf=csrf-token-1; x-ms-cpim-trans=trans-1');
  assert.equal(confirmed.query.csrf_token, SETTINGS.csrf);
  assert.equal(token.form.code, 'code-1');
  assert.equal(token.form.grant_type, 'authorization_code');
  // The password travels in one request only.
  assert.deepEqual(
    fake.calls.filter((c) => Object.values(c.form ?? {}).includes(PASSWORD)).map((c) => c.name),
    ['selfAsserted'],
  );
});

test('sign-in: a wrong password is bad_credentials', async () => {
  fake = installFetch(fluviusRoutes());
  await rejectsWith(authenticate(EMAIL, 'wrong'), 'bad_credentials');
  assert.ok(!fake.calls.some((c) => c.name === 'token'));
});

test('sign-in: a page instead of the code (second factor...) is interaction_required', async () => {
  fake = installFetch(fluviusRoutes({ confirmed: () => html('<html>Verificatiecode</html>') }));
  await rejectsWith(authenticate(EMAIL, PASSWORD), 'interaction_required');
  fake.restore();
  fake = installFetch(
    fluviusRoutes({
      confirmed: () => redirect('https://mijn.fluvius.be/?error=access_denied&error_description=x'),
    }),
  );
  await rejectsWith(authenticate(EMAIL, PASSWORD), 'interaction_required');
});

test('sign-in: a redirect or a tenant outside Fluvius is refused, nothing sent there', async () => {
  fake = installFetch(
    fluviusRoutes({ confirmed: () => redirect('https://evil.example/?code=x&state=y') }),
  );
  await rejectsWith(authenticate(EMAIL, PASSWORD), 'login_changed');
  assert.ok(fake.calls.every((c) => c.host.endsWith('fluvius.be')));
  fake.restore();
  fake = installFetch(
    fluviusRoutes({
      authorize: () =>
        html(
          loginPage({
            ...SETTINGS,
            hosts: { ...SETTINGS.hosts, tenant: 'https://evil.example/t' },
          }),
        ),
    }),
  );
  await rejectsWith(authenticate(EMAIL, PASSWORD), 'login_changed');
  assert.ok(!fake.calls.some((c) => c.name === 'selfAsserted' || c.host === 'evil.example'));
});

test('sign-in: a changed login page, a state mismatch, a 5xx', async () => {
  fake = installFetch(fluviusRoutes({ authorize: () => html('<html>nouveau</html>') }));
  await rejectsWith(authenticate(EMAIL, PASSWORD), 'login_changed');
  fake.restore();
  fake = installFetch(
    fluviusRoutes({ confirmed: () => redirect('https://mijn.fluvius.be/?state=other&code=c') }),
  );
  await rejectsWith(authenticate(EMAIL, PASSWORD), 'login_changed');
  fake.restore();
  fake = installFetch(fluviusRoutes({ msal: () => json({}, 503) }));
  await rejectsWith(authenticate(EMAIL, PASSWORD), 'http');
  await rejectsWith(authenticate('', PASSWORD), 'no_credentials');
});

test('an answer too large is refused while it is read', async () => {
  fake = installFetch(fluviusRoutes({ authorize: () => html('x'.repeat(MAX_BODY_BYTES + 10)) }));
  await rejectsWith(authenticate(EMAIL, PASSWORD), 'too_large');
});

// --- The client ----------------------------------------------------------------------

function client(clock = { now: NOW }) {
  return new FluviusClient({ email: EMAIL, password: PASSWORD, now: () => clock.now });
}

const range = { historyFrom: 'a', historyUntil: 'b', granularity: '1' };

test('readings: EAN in the path, serial and asServiceProvider in the query, token kept', async () => {
  fake = installFetch(fluviusRoutes({ history: () => json([]) }));
  const clock = { now: NOW };
  const c = client(clock);
  assert.deepEqual(await c.history(ELEC_EAN, ELEC_SERIAL, range), []);
  await c.history(ELEC_EAN, ELEC_SERIAL, range);
  const reads = fake.named('history');
  assert.equal(reads[0].path, `/verbruik/api/meter-measurement-history/${ELEC_EAN}`);
  assert.deepEqual(reads[0].query, {
    historyFrom: 'a',
    historyUntil: 'b',
    granularity: '1',
    asServiceProvider: 'false',
    meterSerialNumber: ELEC_SERIAL,
  });
  assert.equal(reads[0].headers.Authorization, 'Bearer acc-1');
  assert.equal(fake.named('token').length, 1, 'one sign-in for both reads');
  // Expired (3600 s minus a minute of margin): one new sign-in.
  clock.now += 3600_000;
  await c.history(ELEC_EAN, ELEC_SERIAL, range);
  assert.equal(fake.named('token').length, 2);
});

test('a 401 signs in once and retries once, never in a loop', async () => {
  fake = installFetch(fluviusRoutes({ history: () => json({}, 401) }));
  await rejectsWith(client().history(ELEC_EAN, ELEC_SERIAL, range), 'token_refused');
  assert.equal(fake.named('history').length, 2);
  assert.equal(fake.named('token').length, 2);
});

test('refused credentials are not tried again for 6 hours', async () => {
  fake = installFetch(fluviusRoutes());
  const clock = { now: NOW };
  const c = new FluviusClient({ email: EMAIL, password: 'wrong', now: () => clock.now });
  await rejectsWith(c.history(ELEC_EAN, ELEC_SERIAL, range), 'bad_credentials');
  const calls = fake.calls.length;
  await rejectsWith(c.history(ELEC_EAN, ELEC_SERIAL, range), 'bad_credentials');
  assert.equal(fake.calls.length, calls, 'no call while blocked');
  clock.now += CREDENTIALS_RETRY;
  await rejectsWith(c.history(ELEC_EAN, ELEC_SERIAL, range), 'bad_credentials');
  assert.ok(fake.calls.length > calls);
});

test('a 429 pauses every call, bounded between 1 minute and 6 hours', async () => {
  fake = installFetch(fluviusRoutes({ history: () => json({}, 429, { 'retry-after': '0' }) }));
  const clock = { now: NOW };
  const c = client(clock);
  await assert.rejects(c.history(ELEC_EAN, ELEC_SERIAL, range), (err) => {
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.retryAfter, RATE_LIMIT_MIN);
    return true;
  });
  const calls = fake.calls.length;
  await rejectsWith(c.spikes(ELEC_EAN, ELEC_SERIAL, range), 'rate_limited');
  assert.equal(fake.calls.length, calls, 'nothing sent during the pause');
  clock.now += RATE_LIMIT_MIN;
  fake.restore();
  fake = installFetch(fluviusRoutes({ history: () => json({}, 429, { 'retry-after': '999999' }) }));
  await assert.rejects(c.history(ELEC_EAN, ELEC_SERIAL, range), (err) => {
    assert.equal(err.retryAfter, RATE_LIMIT_MAX);
    return true;
  });
});

test('data errors are sorted: 403, 404, 400, 5xx, not a list', async () => {
  for (const [status, code] of [
    [403, 'forbidden'],
    [404, 'not_found'],
    [400, 'bad_request'],
    [502, 'http'],
  ]) {
    fake = installFetch(fluviusRoutes({ history: () => json({}, status) }));
    await rejectsWith(client().history(ELEC_EAN, ELEC_SERIAL, range), code);
    fake.restore();
  }
  fake = installFetch(fluviusRoutes({ history: () => json({ not: 'a list' }) }));
  await rejectsWith(client().history(ELEC_EAN, ELEC_SERIAL, range), 'http');
});
