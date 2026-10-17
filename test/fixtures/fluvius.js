// -----------------------------------------------------------------------------
// Sample Mijn Fluvius answers, shaped like those of the reference project's
// tests (sander110419/Fluvius-home-assistant) and its B2C login pages.
// -----------------------------------------------------------------------------

import { html, json, redirect } from '../helpers/fakeFetch.js';
import { nextLocalDay } from '../../src/fluvius/model.js';

export const TZ = 'Europe/Brussels';
/** Friday 16 October 2026, 10:00 in Brussels (summer time, UTC+2). */
export const NOW = Date.parse('2026-10-16T08:00:00Z');
export const EMAIL = 'me@example.be';
export const PASSWORD = 'pa ss';
export const ELEC_EAN = '541448800000000001';
export const ELEC_SERIAL = '1SAG1100000001';
export const GAS_EAN = '541448800000000002';
export const GAS_SERIAL = '2GAS0000000002';
export const AUTHORITY =
  'https://login.fluvius.be/klanten.onmicrosoft.com/B2C_1A_customer_signup_signin';

export const MSAL = {
  auth: {
    clientId: 'client-123',
    authority: AUTHORITY,
    redirectUri: 'https://mijn.fluvius.be/',
  },
  scopes: ['https://klanten.onmicrosoft.com/MijnFluvius/user_impersonation'],
};

export const SETTINGS = {
  csrf: 'csrf-token-1',
  transId: 'StateProperties=eyJUSUQiOiIxIn0',
  api: 'CombinedSigninAndSignup',
  hosts: {
    tenant: '/klanten.onmicrosoft.com/B2C_1A_customer_signup_signin',
    policy: 'B2C_1A_customer_signup_signin',
  },
};

export const SA_FIELDS = {
  AttributeFields: [
    { ID: 'signInName', IS_PASSWORD: false },
    { ID: 'password', IS_PASSWORD: true },
  ],
};

export const loginPage = (settings = SETTINGS, fields = SA_FIELDS) => `<!DOCTYPE html>
<html><head><title>Aanmelden</title>
<script>
var CONTENT = {"button_signin":"Aanmelden"};
var SETTINGS = ${JSON.stringify(settings)};
var SA_FIELDS = ${JSON.stringify(fields)};
</script></head><body><div id="api"></div></body></html>`;

export const B2C_COOKIES = [
  'x-ms-cpim-csrf=csrf-token-1; domain=login.fluvius.be; path=/; secure; HttpOnly; SameSite=None',
  'x-ms-cpim-trans=trans-1; path=/; secure; HttpOnly',
];

const MINUTE = 60_000;

/** The quarter hours between two instants: 0.1 kWh offtake, 0.02 kWh injection each. */
export function quarters(from, to, { kwh = 0.1, injection = 0.02 } = {}) {
  const out = [];
  for (let t = from; t < to; t += 15 * MINUTE) {
    const register = new Date(t).getUTCHours() < 5 ? 2 : 1;
    out.push({
      d: new Date(t).toISOString().replace('.000Z', 'Z'),
      de: new Date(t + 15 * MINUTE).toISOString().replace('.000Z', 'Z'),
      v: [
        { dc: register, t: 1, st: 0, v: kwh, vs: 2, u: 3, gcuv: null },
        { dc: register, t: 2, st: 0, v: injection, vs: 2, u: 3, gcuv: null },
      ],
    });
  }
  return out;
}

/** Gas hours: m³ and kWh, as Fluvius answers both. */
export function gasHours(from, to, { kwh = 1.2 } = {}) {
  const out = [];
  for (let t = from; t < to; t += 60 * MINUTE) {
    out.push({
      d: new Date(t).toISOString(),
      de: new Date(t + 60 * MINUTE).toISOString(),
      v: [
        { dc: 0, t: 1, v: kwh / 11, u: 5 },
        { dc: 0, t: 1, v: kwh, u: 3 },
      ],
    });
  }
  return out;
}

/** Local days between two instants: one period each. */
export function days(from, to, { kwh = 9.6, injection = 1.92 } = {}) {
  const out = [];
  for (let t = from; t < to; t = nextLocalDay(t, TZ)) {
    out.push({
      d: new Date(t).toISOString(),
      de: new Date(nextLocalDay(t, TZ)).toISOString(),
      v: [
        { dc: 1, t: 1, v: kwh / 2, u: 3 },
        { dc: 2, t: 1, v: kwh / 2, u: 3 },
        { dc: 1, t: 2, v: injection, u: 3 },
      ],
    });
  }
  return out;
}

export const SPIKES = [
  {
    d: '2026-08-31T22:00:00Z',
    de: '2026-09-30T22:00:00Z',
    v: [{ v: 4.812, sst: '2026-09-12T17:00:00Z', set: '2026-09-12T17:15:00Z' }],
  },
  {
    d: '2026-09-30T22:00:00Z',
    de: '2026-10-31T23:00:00Z',
    v: [{ v: 3.456, sst: '2026-10-07T18:15:00Z', set: '2026-10-07T18:30:00Z' }],
  },
];

/** The default answer of meter-measurement-history to a query. */
export function historyAnswer(query, { gas = false } = {}) {
  const from = Date.parse(query.historyFrom);
  const to = Date.parse(query.historyUntil) + 1;
  if (query.granularity === '1') return quarters(from, to);
  if (query.granularity === '2') return gasHours(from, to);
  if (query.granularity === '4') return days(from, to, gas ? { injection: 0 } : {});
  return [];
}

/** Every route of a working account; `overrides` replaces some. */
export function fluviusRoutes(overrides = {}) {
  let state;
  return {
    msal: () => json(MSAL),
    authorize: (call) => {
      state = call.query.state;
      return html(loginPage(), 200, B2C_COOKIES);
    },
    selfAsserted: (call) =>
      json(
        call.form?.password === PASSWORD
          ? { status: '200' }
          : { status: '400', errorCode: 'AADB2C90225', message: 'Invalid' },
      ),
    confirmed: () =>
      redirect(`https://mijn.fluvius.be/?state=${encodeURIComponent(state)}&code=code-1`),
    token: () => json({ access_token: 'acc-1', expires_in: 3600, token_type: 'Bearer' }),
    history: (call) => json(historyAnswer(call.query, { gas: call.path.endsWith(GAS_EAN) })),
    spikes: () => json(SPIKES),
    ...overrides,
  };
}
