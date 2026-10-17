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
import { KIND, buildMeterDevice, consumptionKey, ids, meterStates } from './devices.js';
import { FluviusError } from './http.js';
import { T, join } from './i18n.js';
import { FluviusClient } from './fluvius/api.js';
import {
  dailyIntervals,
  daysBefore,
  daysOf,
  halfHoursFromHours,
  halfHoursFromQuarters,
  historyRange,
  hoursOf,
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
    /** `${kind}:${ean}` -> { meter, external, backfilledOn, lastDay, peak, refused, noDetailed } */
    this.entries = new Map();
    /** Devices created since the last connection (gladys.devices is refreshed on reconnection). */
    this.createdIds = new Set();
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

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop is done (tests, shutdown). */
  idle() {
    return this.lifecycle;
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

  async doStart(raw) {
    await this.doStop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    this.retryIndex = 0;
    this.entries = new Map(
      this.config.meters.map((meter) => [
        `${meter.kind}:${meter.ean}`,
        { meter, external: ids(this.gladys, meter.kind, meter.ean) },
      ]),
    );
    const problem = this.configProblem();
    if (problem) {
      this.client = undefined;
      await this.setStatus(false, problem);
      return;
    }
    this.client = this.clientFactory({
      email: this.config.email,
      password: this.config.password,
      now: this.now,
    });
    await this.discover();
    // Always armed, whatever the first read gave: never a dead integration.
    this.timerIds.push(
      this.timers.setInterval(() => this.run(generation, () => this.poll()), POLL_INTERVAL),
    );
    await this.run(generation, () => this.poll());
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
    } else if (code === 'bad_credentials' || code === 'no_credentials') {
      await this.setStatus(false, T.badCredentials(hours(CREDENTIALS_RETRY)));
      this.scheduleRetry(CREDENTIALS_RETRY);
    } else if (code === 'interaction_required') {
      await this.setStatus(false, T.interaction(hours(CREDENTIALS_RETRY)));
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
    const problems = created.map((e) => e.refused ?? e.noDetailed).filter(Boolean);
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
    const daily = this.config.resolution === RESOLUTION.DAILY;
    let intervals;
    let lastDay;
    try {
      if (daily) {
        const readings = daysOf(
          await this.client.history(meter.ean, meter.serial, {
            ...historyRange(days[0].from, days.at(-1).to, TIME_ZONE),
            granularity: GRANULARITY.DAY,
          }),
        );
        intervals = dailyIntervals(readings, now, TIME_ZONE);
        lastDay = lastDayFromDays(readings, TIME_ZONE);
      } else {
        // One request per local day, as the reference does.
        const periods = [];
        for (const day of days) {
          const payload = await this.client.history(meter.ean, meter.serial, {
            ...historyRange(day.from, day.to, TIME_ZONE),
            granularity: gas ? GRANULARITY.HOUR : GRANULARITY.QUARTER_HOUR,
          });
          periods.push(...(gas ? hoursOf(payload) : quartersOf(payload)));
        }
        intervals = gas ? halfHoursFromHours(periods, now) : halfHoursFromQuarters(periods, now);
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
    if (!gas) {
      entry.peak = (await this.readPeak(entry, now)) ?? entry.peak;
    }
    const published = await this.publishConsumption(entry, intervals);
    if (full && published) {
      entry.backfilledOn = today;
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
      if (!isMeterError(err)) {
        throw err;
      }
      this.logger.warn(`Fluvius peak unavailable: ${err.message}`);
      return undefined;
    }
  }

  /** Resolves true when Gladys took every interval (or there was none). */
  async publishConsumption(entry, intervals) {
    const feature = entry.external.feature(consumptionKey(this.config.resolution));
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
    if (code === 'bad_credentials' || code === 'no_credentials') {
      return T.badCredentials(hours(CREDENTIALS_RETRY));
    }
    if (code === 'interaction_required') return T.interaction(hours(CREDENTIALS_RETRY));
    return T.retry(minutes(RETRY_BACKOFF[0]), err?.message ?? String(err));
  }

  /** The test button: sign in and read yesterday's total of each meter. */
  async testConnection() {
    const problem = this.configProblem();
    if (problem || !this.client) {
      return problem ?? T.noCredentials;
    }
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
