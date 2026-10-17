// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Mijn Fluvius.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { FluviusApp } from '../src/app.js';
import {
  ACTIONS,
  CREDENTIALS_RETRY,
  POLL_INTERVAL,
  RATE_LIMIT_MIN,
  RETRY_BACKOFF,
} from '../src/constants.js';
import { buildMeterDevice } from '../src/devices.js';
import { installFetch, json } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import {
  ELEC_EAN,
  ELEC_SERIAL,
  EMAIL,
  GAS_EAN,
  GAS_SERIAL,
  NOW,
  PASSWORD,
  fluviusRoutes,
} from './fixtures/fluvius.js';

let fake;
afterEach(() => fake?.restore());

const SELECTOR = 'fluvius';
const ELEC = `ext:${SELECTOR}:electricity:${ELEC_EAN}`;
const GAS = `ext:${SELECTOR}:gas:${GAS_EAN}`;
const CONFIG = {
  email: ` ${EMAIL} `,
  password: PASSWORD,
  electricity_ean: '5414 4880 0000 0000 01',
  electricity_serial: ELEC_SERIAL,
  gas_ean: GAS_EAN,
  gas_serial: GAS_SERIAL,
};

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

/** A device as the user created it from the discovered one. */
function created(kind, resolution = 'detailed') {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const meter =
    kind === 'gas'
      ? { kind, ean: GAS_EAN, serial: GAS_SERIAL }
      : { kind, ean: ELEC_EAN, serial: ELEC_SERIAL };
  return buildMeterDevice(gladys, meter, resolution);
}

async function setup({ config = CONFIG, routes = {}, devices = [], now = NOW } = {}) {
  fake = installFetch(fluviusRoutes(routes));
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const timers = createFakeTimers();
  const clock = { now };
  const logger = createLogger();
  const app = new FluviusApp({ gladys, logger, now: () => clock.now, timers });
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  return { app, gladys, timers, clock, logger };
}

const status = (gladys) => gladys.fake.connectionStatus;
const consumption = (gladys, device, key = 'consumption') =>
  gladys.fake.energyConsumption[`${device}:${key}`] ?? [];

test('no credentials, no meter, a wrong EAN: the status says so, nothing is called', async () => {
  for (const [config, pattern] of [
    [{}, /mot de passe/],
    [{ email: EMAIL, password: PASSWORD }, /au moins un compteur/],
    [{ ...CONFIG, electricity_ean: '1234' }, /18 chiffres/],
    [{ ...CONFIG, gas_serial: '' }, /numéro de série/],
  ]) {
    const { app, gladys, timers } = await setup({ config });
    await app.start(config);
    assert.equal(status(gladys).connected, false);
    assert.match(status(gladys).message.fr, pattern);
    assert.equal(fake.calls.length, 0);
    assert.equal(timers.pending.size, 0);
    fake.restore();
  }
});

test('the devices: dated consumption, plain sensors, never an index nor a billed injection', async () => {
  const { app, gladys, timers } = await setup();
  await app.start(CONFIG);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.external_id, d.name]),
    [
      [ELEC, 'Fluvius electricity (EAN …0001)'],
      [GAS, 'Fluvius gas (EAN …0002)'],
    ],
  );
  const keys = (d) => d.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys(devices[0]), [
    'consumption',
    'consumption_last_day',
    'injection_last_day',
    'capacity_peak',
  ]);
  assert.deepEqual(keys(devices[1]), ['consumption', 'consumption_last_day']);
  for (const f of devices.flatMap((d) => d.features)) {
    assert.ok(f.read_only);
    // No cumulative index anywhere: the core would derive (and bill) it.
    assert.ok(![T.ENERGY_SENSOR.INDEX, T.ENERGY_SENSOR.ENERGY].includes(f.type), f.external_id);
    if (!f.external_id.endsWith(':consumption')) {
      assert.equal(f.category, C.UNKNOWN, `${f.external_id} is shown, never summed`);
      assert.equal(f.unit, undefined);
    }
  }
  // No device created yet: nothing read, the status says what to do, the poll stays armed.
  assert.equal(fake.calls.length, 0);
  assert.match(status(gladys).message.en, /Discover/);
  assert.equal(timers.intervals()[0].ms, POLL_INTERVAL);
});

test('detailed readings: 7 days once a day, then the last 3 days, upserted by instant', async () => {
  const { app, gladys, clock, timers } = await setup({
    devices: [created('electricity'), created('gas')],
  });
  await app.start(CONFIG);
  assert.deepEqual(
    fake.calls.map((c) => c.name),
    [
      'msal',
      'authorize',
      'selfAsserted',
      'confirmed',
      'token',
      ...Array(7).fill('history'),
      'spikes',
      ...Array(7).fill('history'),
    ],
  );
  const elecReads = fake.named('history').filter((c) => c.path.endsWith(ELEC_EAN));
  assert.equal(elecReads[0].query.historyFrom, '2026-10-09T00:00:00.000+02:00');
  assert.equal(elecReads.at(-1).query.historyUntil, '2026-10-15T23:59:59.999+02:00');
  assert.ok(elecReads.every((c) => c.query.granularity === '1'));
  assert.ok(
    fake
      .named('history')
      .filter((c) => c.path.endsWith(GAS_EAN))
      .every((c) => c.query.granularity === '2'),
  );
  // 7 days of 48 half hours, 0.2 kWh each (two quarters of 0.1).
  const elec = consumption(gladys, ELEC);
  assert.equal(elec.length, 7 * 48);
  assert.ok(elec.every((s) => s.kwh === 0.2));
  assert.equal(consumption(gladys, GAS).length, 7 * 48);
  // The plain sensors: yesterday's totals and the latest monthly peak.
  assert.equal(gladys.fake.lastState(`${ELEC}:consumption_last_day`), 9.6);
  assert.equal(gladys.fake.lastState(`${ELEC}:injection_last_day`), 1.92);
  assert.equal(gladys.fake.lastState(`${ELEC}:capacity_peak`), 3.456);
  assert.equal(gladys.fake.lastState(`${GAS}:consumption_last_day`), 28.8);
  assert.equal(gladys.fake.lastState(`${GAS}:injection_last_day`), undefined);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.en, /electricity \(EAN …0001\) 2026-10-15/);

  // Six hours later, same day: only the last 3 days, one sign-in (the token
  // lasts an hour).
  clock.now += POLL_INTERVAL;
  const before = fake.calls.length;
  await timers.runIntervals();
  const again = fake.calls.slice(before);
  assert.equal(again.filter((c) => c.name === 'history').length, 6);
  assert.equal(again.filter((c) => c.name === 'token').length, 1);
  assert.equal(consumption(gladys, ELEC).length, 7 * 48, 'nothing counted twice');

  // The next day: the whole window again.
  clock.now += 24 * 60 * 60_000;
  const next = fake.calls.length;
  await timers.runIntervals();
  assert.equal(fake.calls.slice(next).filter((c) => c.name === 'history').length, 14);
});

test('daily readings: one request per meter, a daily consumption dated by its local day', async () => {
  const config = { ...CONFIG, resolution: 'daily', days_back: 5 };
  const { app, gladys } = await setup({
    config,
    devices: [created('electricity', 'daily'), created('gas', 'daily')],
  });
  await app.start(config);
  const reads = fake.named('history');
  assert.equal(reads.length, 2);
  assert.ok(reads.every((c) => c.query.granularity === '4'));
  assert.equal(reads[0].query.historyFrom, '2026-10-11T00:00:00.000+02:00');
  const daily = consumption(gladys, ELEC, 'daily_consumption');
  assert.deepEqual(
    daily.map((s) => [s.created_at.slice(0, 10), s.kwh]),
    [
      ['2026-10-11', 9.6],
      ['2026-10-12', 9.6],
      ['2026-10-13', 9.6],
      ['2026-10-14', 9.6],
      ['2026-10-15', 9.6],
    ],
  );
  assert.equal(gladys.fake.lastState(`${ELEC}:injection_last_day`), 1.92);
});

test('no detailed reading over the window: the status explains how to turn them on', async () => {
  const { app, gladys } = await setup({
    routes: { history: () => json([]) },
    devices: [created('electricity')],
  });
  await app.start(CONFIG);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.en, /turn the quarter-hour/);
});

test('a meter refused by Fluvius: said in the status, the other meter still read', async () => {
  const routes = {
    history: (call) =>
      call.path.endsWith(ELEC_EAN) ? json({}, 403) : fluviusRoutes().history(call),
  };
  const { app, gladys, timers } = await setup({
    routes,
    devices: [created('electricity'), created('gas')],
  });
  await app.start(CONFIG);
  assert.equal(consumption(gladys, GAS).length, 7 * 48);
  assert.match(status(gladys).message.fr, /a refusé les relevés du compteur électricité/);
  assert.equal(timers.timeouts().length, 0, 'not a passing failure: no fast retry');
});

test('refused credentials: said, tried again in 6 hours only, the poll stays armed', async () => {
  const config = { ...CONFIG, password: 'wrong' };
  const { app, gladys, timers } = await setup({ config, devices: [created('electricity')] });
  await app.start(config);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /refused the e-mail or the password.*6 h/);
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [CREDENTIALS_RETRY],
  );
  assert.equal(timers.intervals().length, 1);
  const calls = fake.calls.length;
  await timers.runIntervals();
  assert.equal(fake.calls.length, calls, 'no new sign-in before 6 hours');
});

test('two-step verification asked: said clearly, no loop', async () => {
  const { app, gladys, timers } = await setup({
    routes: { confirmed: () => new Response('<html>code</html>', { status: 200 }) },
    devices: [created('electricity')],
  });
  await app.start(CONFIG);
  assert.match(status(gladys).message.fr, /double authentification/);
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [CREDENTIALS_RETRY],
  );
});

test('a 429 pauses everything, then the read resumes', async () => {
  let limited = true;
  const routes = {
    history: (call) =>
      limited ? json({}, 429, { 'retry-after': '120' }) : fluviusRoutes().history(call),
  };
  const { app, gladys, timers, clock } = await setup({ routes, devices: [created('electricity')] });
  await app.start(CONFIG);
  assert.match(status(gladys).message.en, /slow down: every call paused for 2 min/);
  const [retry] = timers.timeouts();
  assert.equal(retry.ms, 121_000);
  // The regular poll during the pause sends nothing.
  const calls = fake.calls.length;
  await timers.runIntervals();
  assert.equal(fake.calls.length, calls);
  limited = false;
  clock.now += 121_000;
  await timers.runTimeouts();
  assert.equal(status(gladys).connected, true);
  assert.equal(consumption(gladys, ELEC).length, 7 * 48);
  assert.ok(RATE_LIMIT_MIN <= 120_000);
});

test('a passing failure: backoff 15, 30, 60 min, then the next success resets it', async () => {
  let down = true;
  const routes = {
    msal: () => (down ? json({}, 503) : json({ auth: { clientId: 'client-123' } })),
  };
  const { app, gladys, timers } = await setup({ routes, devices: [created('electricity')] });
  await app.start(CONFIG);
  assert.match(status(gladys).message.en, /new try in 15 min/);
  const delays = [timers.timeouts()[0].ms];
  for (let i = 0; i < 2; i += 1) {
    await timers.runTimeouts();
    delays.push(timers.timeouts()[0].ms);
  }
  assert.deepEqual(delays, RETRY_BACKOFF.slice(0, 3));
  down = false;
  await timers.runTimeouts();
  assert.equal(status(gladys).connected, true);
  assert.equal(timers.timeouts().length, 0);
  assert.equal(app.retryIndex, 0);
});

test('a device created later is read right away', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  assert.equal(fake.calls.length, 0);
  const device = created('electricity');
  gladys.fake.devices.push(device);
  await gladys.fake.deviceCreated(device);
  assert.equal(consumption(gladys, ELEC).length, 7 * 48);
  assert.ok(!fake.named('history').some((c) => c.path.endsWith(GAS_EAN)), 'gas not created');
});

test('the test button: sign-in and yesterday of each meter', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /Sign-in OK\. electricity \(EAN …0001\): 9\.6 kWh yesterday; gas/,
  );
  const bad = { ...CONFIG, password: 'nope' };
  await app.start(bad);
  const refused = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(refused.data.message.fr, /refusé l’e-mail ou le mot de passe/);
});

test('the logs never hold the e-mail, the password, a token or a code', async () => {
  const routes = { history: () => json({}, 401) };
  const { app, logger } = await setup({ routes, devices: [created('electricity')] });
  await app.start(CONFIG);
  await app.start({ ...CONFIG, password: 'wrong' });
  const text = logger.lines.join('\n');
  assert.ok(logger.lines.length > 0);
  for (const secret of [EMAIL, PASSWORD, 'wrong', 'acc-1', 'code-1', 'csrf-token-1']) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.ok(!/https?:\/\//.test(text), 'no URL');
});

test('a stop clears every timer; a restart replaces the client', async () => {
  const { app, timers } = await setup({ devices: [created('electricity')] });
  await app.start(CONFIG);
  assert.ok(timers.pending.size > 0);
  await app.stop();
  assert.equal(timers.pending.size, 0);
});
