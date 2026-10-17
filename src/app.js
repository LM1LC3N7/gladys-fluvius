// -----------------------------------------------------------------------------
// The integration itself: the meters of the configuration, their dated
// consumption fed to the Gladys energy monitoring (publishEnergyConsumption),
// the last published day and the monthly capacity peak as plain sensors, the
// schedule (4 reads a day, recent days read again, backoff, 429 pause) and the
// test button. index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { RESOLUTION, normalizeConfig } from './config.js';
import {
  CREDENTIALS_RETRY,
  GRANULARITY,
  MAX_INTERVALS_PER_CALL,
  POLL_INTERVAL,
  RATE_LIMIT_PAUSE,
  RECENT_DAYS,
  RETRY_BACKOFF,
  TEST_ANSWER_WITHIN,
  TIME_ZONE,
} from './constants.js';
import {
  KIND,
  buildMeterDevice,
  consumptionKey,
  ids,
  meterStates,
  resolutionOf,
} from './devices.js';
import { FluviusError } from './http.js';
import { T, join } from './i18n.js';
import { FluviusClient } from './fluvius/api.js';
import {
  dailyIntervals,
  daysBefore,
  daysOf,
  halfHoursFromQuarters,
  historyRange,
  lastCompleteDay,
  lastDayFromDays,
  latestPeak,
  localDate,
  nextLocalDay,
  quartersOf,
  startOfLocalDay,
} from './fluvius/model.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
/** Errors about one meter (wrong EAN, serial, or a meter of another account): the others go on. */
const METER_ERRORS = new Set(['forbidden', 'not_found', 'bad_request']);
const isMeterError = (err) => err instanceof FluviusError && METER_ERRORS.has(err.code);
/** Errors that stop every call: they go up from any optional read. */
const GLOBAL_ERRORS = new Set([
  'rate_limited',
  'bad_credentials',
  'interaction_required',
  'no_credentials',
  'token_refused',
]);
/** Errors only a person (or an update of the integration) can solve: one try every 6 hours. */
const SLOW_RETRY = {
  bad_credentials: (h) => T.badCredentials(h),
  no_credentials: (h) => T.badCredentials(h),
  interaction_required: (h) => T.interaction(h),
  token_refused: (h) => T.tokenRefused(h),
  login_changed: (h, err) => T.loginChanged(h, err.message),
};
const minutes = (ms) => Math.max(1, Math.ceil(ms / 60_000));
const hours = (ms) => Math.round(ms / 3_600_000);
const validMeter = (m) => /^\d{18}$/.test(m.ean) && m.serial.length > 0;

/** The first instant of the month before the one of `now` (local). */
function previousMonthStart(now, timeZone) {
  const [year, month] = localDate(now, timeZone).split('-').map(Number);
  return startOfLocalDay(Date.UTC(year, month - 2, 1, 12), timeZone);
}

export class FluviusApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'fluvius' }),
    now = Date.now,
    timers = defaultTimers,
    clientFactory = (options) => new FluviusClient(options),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.config = normalizeConfig();
    this.client = undefined;
    /** The 429 pause, kept across restarts, reconnections and clients. */
    this.pause = { until: 0 };
    /**
     * `${kind}:${ean}` -> { meter, external, backfilledOn, lastDay, peak,
     * refused, noDetailed, mismatch }
     */
    this.entries = new Map();
    /** Devices created since the last connection (gladys.devices is refreshed on reconnection). */
    this.createdIds = new Set();
    this.createdDevices = new Map();
    this.firstRun = Promise.resolve();
    this.timerIds = [];
    this.retryTimer = undefined;
    this.retryIndex = 0;
    this.polling = undefined;
    this.lastStatus = undefined;
    this.lastMessage = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `fresh`: the user saved the form (not a reconnection): the 6-hour refusal delay ends. */
  start(raw = {}, { fresh = false } = {}) {
    return this.serialize(() => this.doStart(raw, { fresh }));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the first read after it are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.firstRun;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  /** The problem of the configuration, or undefined when it can run. */
  configProblem() {
    if (!this.config.email || !this.config.password) {
      return T.noCredentials;
    }
    if (this.config.meters.length === 0) {
      return T.noMeter;
    }
    const invalid = this.config.meters.find((m) => !validMeter(m));
    return invalid ? T.badMeter(invalid) : undefined;
  }

  async doStart(raw, { fresh = false } = {}) {
    await this.doStop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    this.retryIndex = 0;
    const previous = this.entries;
    this.entries = new Map(
      this.config.meters.map((meter) => {
        const key = `${meter.kind}:${meter.ean}`;
        const known = previous.get(key);
        // A reconnection keeps what was read (the full window is not read again).
        return [
          key,
          known && known.meter.serial === meter.serial
            ? { ...known, meter }
            : { meter, external: ids(this.gladys, meter.kind, meter.ean) },
        ];
      }),
    );
    const problem = this.configProblem();
    if (problem) {
      this.client = undefined;
      await this.setStatus(false, problem);
      return;
    }
    // The same credentials keep the client: its token and its refusal delay
    // survive a reconnection or a save of the form.
    if (
      !this.client ||
      this.client.email !== this.config.email ||
      this.client.password !== this.config.password
    ) {
      this.client = this.clientFactory({
        email: this.config.email,
        password: this.config.password,
        now: this.now,
        pause: this.pause,
      });
    } else if (fresh) {
      // The user saved the form: maybe after fixing the account in a
      // browser. The 6-hour refusal delay ends; the 429 pause never does.
      this.client.unblock();
    }
    await this.discover();
    // Always armed, whatever the first read gave: never a dead integration.
    this.timerIds.push(
      this.timers.setInterval(() => this.run(generation, () => this.poll()), POLL_INTERVAL),
    );
    // Not awaited: a start (a save of the form) answers at once.
    // A read of the previous start still running is let finish first.
    const running = this.polling?.catch(() => {});
    this.firstRun = Promise.resolve(running).then(() => this.run(generation, () => this.poll()));
  }

  async doStop() {
    this.generation += 1;
    for (const id of this.timerIds) {
      this.timers.clearInterval(id);
    }
    this.timerIds = [];
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /** Run a job of a generation: nothing after a restart, its errors reported. */
  async run(generation, job) {
    if (generation !== this.generation) {
      return;
    }
    try {
      await job();
    } catch (err) {
      if (generation === this.generation) {
        await this.failed(err);
      }
    }
  }

  scheduleRetry(delay) {
    const generation = this.generation;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      return this.run(generation, () => this.poll());
    }, delay);
  }

  /** A failed read: say why, and plan the next try. */
  async failed(err) {
    // FluviusError messages never hold the e-mail, the password, a token or a URL.
    this.logger.warn(`Fluvius: ${err?.message ?? err}`);
    const code = err instanceof FluviusError ? err.code : 'unknown';
    if (code === 'rate_limited') {
      const delay = err.retryAfter ?? RATE_LIMIT_PAUSE;
      await this.setStatus(false, T.rateLimited(minutes(delay)));
      this.scheduleRetry(delay + 1000);
    } else if (SLOW_RETRY[code]) {
      await this.setStatus(false, SLOW_RETRY[code](hours(CREDENTIALS_RETRY), err));
      this.scheduleRetry(CREDENTIALS_RETRY);
    } else {
      const delay = RETRY_BACKOFF[Math.min(this.retryIndex, RETRY_BACKOFF.length - 1)];
      this.retryIndex += 1;
      await this.setStatus(false, T.retry(minutes(delay), err?.message ?? String(err)));
      this.scheduleRetry(delay);
    }
  }

  async setStatus(connected, message) {
    this.lastMessage = message;
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async reportOk() {
    const created = [...this.entries.values()].filter((e) => this.isCreated(e));
    if (created.length === 0) {
      await this.setStatus(true, T.noDevice);
      return;
    }
    const problems = created
      .flatMap((e) => [e.refused ?? e.noDetailed, e.mismatch])
      .filter(Boolean);
    const ok = T.ok(created.map((e) => ({ meter: e.meter, date: e.lastDay?.date })));
    await this.setStatus(true, problems.length > 0 ? join([...problems, ok]) : ok);
  }

  // --- Devices ---------------------------------------------------------------------

  async discover() {
    if (this.configProblem()) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices(
        [...this.entries.values()].map((e) =>
          buildMeterDevice(this.gladys, e.meter, this.config.resolution),
        ),
      )
      .catch((err) => this.logger.warn(`Publishing the Fluvius devices failed: ${err.message}`));
  }

  /** Whether the user created the device of a meter (Fluvius is not read otherwise). */
  isCreated(entry) {
    const id = entry.external.device;
    return this.createdIds.has(id) || (this.gladys.devices ?? []).some((d) => d.external_id === id);
  }

  /** A meter device was just created: its readings are read right away. */
  async onDeviceCreated(device) {
    const id = device?.external_id;
    if (!id) {
      return;
    }
    this.createdIds.add(id);
    this.createdDevices.set(id, device);
    const entry = [...this.entries.values()].find((e) => e.external.device === id);
    if (entry && this.client) {
      entry.backfilledOn = undefined;
      // A read in progress listed the meters before this one existed.
      await this.polling?.catch(() => {});
      await this.run(this.generation, () => this.poll());
    }
  }

  onDeviceDeleted(device) {
    this.createdIds.delete(device?.external_id);
    this.createdDevices.delete(device?.external_id);
  }

  // --- Readings ----------------------------------------------------------------------

  /** One read of every created meter; concurrent callers share it. */
  poll() {
    if (this.polling) {
      return this.polling;
    }
    this.polling = this.doPoll().finally(() => {
      this.polling = undefined;
    });
    return this.polling;
  }

  async doPoll() {
    if (!this.client) {
      return;
    }
    const created = [...this.entries.values()].filter((e) => this.isCreated(e));
    for (const entry of created) {
      await this.readMeter(entry);
    }
    this.retryIndex = 0;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    await this.reportOk();
  }

  /**
   * The readings of a meter: every day of the window once a day (Fluvius
   * publishes late and corrects), the last RECENT_DAYS otherwise. The core
   * upserts by instant: a day read again never counts twice.
   */
  async readMeter(entry) {
    const { meter } = entry;
    const now = this.now();
    const today = localDate(now, TIME_ZONE);
    const full = entry.backfilledOn !== today;
    const days = daysBefore(
      now,
      full ? this.config.daysBack : Math.min(RECENT_DAYS, this.config.daysBack),
      TIME_ZONE,
    );
    const gas = meter.kind === KIND.GAS;
    // The gas only shows its daily total (it stays out of the energy
    // monitoring); the electricity follows the feature of the created device.
    const resolution = gas ? RESOLUTION.DAILY : this.resolutionFor(entry);
    const daily = resolution === RESOLUTION.DAILY;
    let intervals = [];
    let lastDay;
    try {
      if (daily) {
        const readings = daysOf(
          await this.client.history(meter.ean, meter.serial, {
            ...historyRange(days[0].from, days.at(-1).to, TIME_ZONE),
            granularity: GRANULARITY.DAY,
          }),
        );
        if (!gas) {
          intervals = dailyIntervals(readings, now, TIME_ZONE);
        }
        lastDay = lastDayFromDays(readings, TIME_ZONE);
      } else {
        // One request per local day, as the reference does.
        const periods = [];
        for (const day of days) {
          periods.push(
            ...quartersOf(
              await this.client.history(meter.ean, meter.serial, {
                ...historyRange(day.from, day.to, TIME_ZONE),
                granularity: GRANULARITY.QUARTER_HOUR,
              }),
            ),
          );
        }
        intervals = halfHoursFromQuarters(periods, now);
        lastDay = lastCompleteDay(periods, days);
      }
    } catch (err) {
      if (!isMeterError(err)) {
        throw err;
      }
      this.logger.warn(`Fluvius ${meter.kind} meter: ${err.message}`);
      entry.refused = T.meterRefused(meter, err.message);
      return;
    }
    entry.refused = undefined;
    // Nothing detailed over a whole window: most often the quarter-hour
    // readings are not turned on in Mijn Fluvius. A shorter read changes nothing.
    if (daily || intervals.length > 0) {
      entry.noDetailed = undefined;
    } else if (full) {
      entry.noDetailed = T.noDetailed(meter, days.length);
    }
    if (lastDay && (!entry.lastDay || lastDay.date >= entry.lastDay.date)) {
      entry.lastDay = gas ? { date: lastDay.date, consumption: lastDay.consumption } : lastDay;
    }
    // The consumption first: a failed peak read never holds it back.
    const published = gas || (await this.publishConsumption(entry, intervals, resolution));
    if (full && published) {
      entry.backfilledOn = today;
    }
    if (!gas) {
      entry.peak = (await this.readPeak(entry, now)) ?? entry.peak;
    }
    const states = meterStates(entry.external, entry);
    if (states.length > 0) {
      await this.gladys
        .publishChangedStates(states, { heartbeat: 12 * 60 * 60_000 })
        .catch((err) => this.logger.warn(`Fluvius states failed: ${err.message}`));
    }
  }

  /** The capacity tariff peak of the latest month published; a failure holds back nothing. */
  async readPeak(entry, now) {
    try {
      const payload = await this.client.spikes(entry.meter.ean, entry.meter.serial, {
        ...historyRange(
          previousMonthStart(now, TIME_ZONE),
          nextLocalDay(now, TIME_ZONE),
          TIME_ZONE,
        ),
      });
      return latestPeak(payload, TIME_ZONE);
    } catch (err) {
      // Only what stops every call goes up; anything else keeps the old peak.
      if (err instanceof FluviusError && GLOBAL_ERRORS.has(err.code)) {
        throw err;
      }
      this.logger.warn(`Fluvius peak unavailable: ${err?.message ?? err}`);
      return undefined;
    }
  }

  /**
   * The resolution of an electricity meter: the one of the consumption
   * feature of its created device (its type is fixed at creation), else the
   * configuration. A difference is shown in the status.
   */
  resolutionFor(entry) {
    const device =
      this.createdDevices.get(entry.external.device) ??
      (this.gladys.devices ?? []).find((d) => d.external_id === entry.external.device);
    const created = resolutionOf(device);
    entry.mismatch =
      created && created !== this.config.resolution
        ? T.resolutionMismatch(entry.meter, created)
        : undefined;
    return created ?? this.config.resolution;
  }

  /** Resolves true when Gladys took every interval (or there was none). */
  async publishConsumption(entry, intervals, resolution) {
    const feature = entry.external.feature(consumptionKey(resolution));
    try {
      for (let i = 0; i < intervals.length; i += MAX_INTERVALS_PER_CALL) {
        await this.gladys.publishEnergyConsumption(
          feature,
          intervals.slice(i, i + MAX_INTERVALS_PER_CALL),
        );
      }
      return true;
    } catch (err) {
      // 404: the device was deleted meanwhile; 400: most often the resolution
      // changed after the device was created (its feature is the old one).
      const log = err?.status === 404 ? this.logger.debug : this.logger.warn;
      log?.call(this.logger, `Fluvius consumption not published: ${err.message}`);
      return false;
    }
  }

  // --- Configuration screen button --------------------------------------------------------

  messageOf(err) {
    const code = err instanceof FluviusError ? err.code : 'unknown';
    if (code === 'rate_limited') return T.rateLimited(minutes(err.retryAfter ?? RATE_LIMIT_PAUSE));
    if (SLOW_RETRY[code]) return SLOW_RETRY[code](hours(CREDENTIALS_RETRY), err);
    return T.retry(minutes(RETRY_BACKOFF[0]), err?.message ?? String(err));
  }

  /** The test button: sign in and read yesterday's total of each meter. */
  async testConnection() {
    const problem = this.configProblem();
    if (problem || !this.client) {
      return problem ?? T.noCredentials;
    }
    // A press of the button is one real try: the 6-hour refusal delay does
    // not answer for Fluvius (the 429 pause still does).
    this.client.unblock();
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    try {
      return await Promise.race([this.check(), late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  async check() {
    const [yesterday] = daysBefore(this.now(), 1, TIME_ZONE);
    const parts = [];
    for (const { meter } of this.entries.values()) {
      try {
        const readings = daysOf(
          await this.client.history(meter.ean, meter.serial, {
            ...historyRange(yesterday.from, yesterday.to, TIME_ZONE),
            granularity: GRANULARITY.DAY,
          }),
        );
        parts.push({ meter, kwh: readings.at(-1)?.consumption });
      } catch (err) {
        return isMeterError(err) ? T.meterRefused(meter, err.message) : this.messageOf(err);
      }
    }
    return T.test.ok(parts);
  }
}
