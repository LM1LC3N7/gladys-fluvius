// -----------------------------------------------------------------------------
// What the Mijn Fluvius answers mean. Pure: no network, no Gladys.
//
// A meter-measurement-history answer is a list of periods:
//   { d: start, de: end, v: [{ dc, t, u, v }, ...] }
// where `t` is the direction (1 = offtake, 2 = injection), `dc` the tariff
// register (0 single, 1 day, 2 night), `u` the unit (3 = kWh, 5 = m³) and
// `v` the value. Ported from sander110419/Fluvius-home-assistant (MIT,
// custom_components/fluvius/api.py `_summarize_day`, `_metric_from_reading`,
// `_quarter_hourly_from_payload`, `_spikes_from_payload`).
// A meter-measurement-spikes answer is a list of months:
//   { d, de, v: [{ v: kW, sst: start, set: end }] }
// -----------------------------------------------------------------------------

import { UNIT_KWH } from '../constants.js';

const MINUTE = 60_000;
const QUARTER = 15 * MINUTE;
const HALF_HOUR = 30 * MINUTE;
const HOUR = 60 * MINUTE;
const round = (value) => Math.round(value * 1e6) / 1e6;

// --- Local time ------------------------------------------------------------------

/** The local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(t, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
}

function localParts(t, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date(t))
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return parts;
}

/** The local midnight starting the day of `t` (DST-safe: steps back by half hours). */
export function startOfLocalDay(t, timeZone) {
  const date = localDate(t, timeZone);
  let start = Math.floor(t / HALF_HOUR) * HALF_HOUR;
  while (localDate(start - HALF_HOUR, timeZone) === date) {
    start -= HALF_HOUR;
  }
  return start;
}

/** The local midnight starting the day after `t` (a day lasts 23 to 25 hours). */
export function nextLocalDay(t, timeZone) {
  const date = localDate(t, timeZone);
  let next = startOfLocalDay(t, timeZone) + 22 * HOUR;
  while (localDate(next, timeZone) === date) {
    next += HALF_HOUR;
  }
  return next;
}

/** `2026-10-16T00:00:00.000+02:00`: the local time with its offset, as the API takes it. */
export function isoLocal(t, timeZone) {
  const p = localParts(t, timeZone);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = Math.round((wall - Math.floor(t / 1000) * 1000) / MINUTE);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  const ms = pad(((t % 1000) + 1000) % 1000, 3);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${ms}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * The local days to read, oldest first: the `count` days before today
 * (today is never complete, and Fluvius publishes it later anyway).
 * Each `{ date, from, to }`, `to` excluded.
 */
export function daysBefore(now, count, timeZone) {
  const days = [];
  let to = startOfLocalDay(now, timeZone);
  for (let i = 0; i < count; i += 1) {
    const from = startOfLocalDay(to - 1, timeZone);
    days.unshift({ date: localDate(from, timeZone), from, to });
    to = from;
  }
  return days;
}

/** The query bounds of a range: `historyFrom` and `historyUntil` (the last millisecond). */
export function historyRange(from, to, timeZone) {
  return { historyFrom: isoLocal(from, timeZone), historyUntil: isoLocal(to - 1, timeZone) };
}

// --- Readings -----------------------------------------------------------------------

const time = (value) => {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

/** Offtake and injection (kWh) of one period, or undefined when it has no kWh reading. */
export function energyOf(period) {
  let consumption = 0;
  let injection = 0;
  let matched = false;
  for (const reading of Array.isArray(period?.v) ? period.v : []) {
    const direction = Number(reading?.t ?? 1);
    const register = Number(reading?.dc ?? 0);
    const unit = Number(reading?.u);
    const value = typeof reading?.v === 'number' ? reading.v : Number(reading?.v ?? NaN);
    if (reading?.v === null || !Number.isFinite(value) || value < 0) continue;
    // Gas answers both m³ and kWh: only the kWh feed the energy monitoring.
    if (unit !== UNIT_KWH) continue;
    if (![0, 1, 2].includes(register)) continue;
    if (direction === 1) {
      consumption += value;
    } else if (direction === 2) {
      injection += value;
    } else {
      continue;
    }
    matched = true;
  }
  return matched ? { consumption: round(consumption), injection: round(injection) } : undefined;
}

/**
 * The periods of an answer: `[{ start, end, consumption, injection }]` sorted,
 * one per start (the last one wins). `duration` keeps only the periods of that
 * length (a quarter hour, an hour); a daily answer keeps every period.
 */
export function periodsOf(payload, { duration } = {}) {
  const byStart = new Map();
  for (const period of Array.isArray(payload) ? payload : []) {
    const start = time(period?.d);
    if (start === undefined) continue;
    const end = time(period?.de) ?? (duration ? undefined : start + 24 * HOUR);
    if (end === undefined || end <= start) continue;
    if (duration && end - start !== duration) continue;
    const energy = energyOf(period);
    if (!energy) continue;
    byStart.set(start, { start, end, ...energy });
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

export const quartersOf = (payload) => periodsOf(payload, { duration: QUARTER });
export const hoursOf = (payload) => periodsOf(payload, { duration: HOUR });
export const daysOf = (payload) => periodsOf(payload);

/**
 * Quarter hours -> the 30-minute consumption of the energy monitoring: only
 * complete half hours (both quarters published), never in the future.
 */
export function halfHoursFromQuarters(quarters, now) {
  const halves = new Map();
  for (const q of quarters) {
    const slot = Math.floor(q.start / HALF_HOUR) * HALF_HOUR;
    const half = halves.get(slot) ?? { kwh: 0, parts: new Set() };
    half.kwh += q.consumption;
    half.parts.add(q.start - slot);
    halves.set(slot, half);
  }
  return [...halves.entries()]
    .filter(([slot, half]) => half.parts.size === 2 && slot + HALF_HOUR <= now)
    .sort(([a], [b]) => a - b)
    .map(([slot, half]) => ({ starts_at: new Date(slot).toISOString(), kwh: round(half.kwh) }));
}

/** Hourly readings (gas) -> two equal half hours each, as the SDK advises. */
export function halfHoursFromHours(hours, now) {
  const out = [];
  for (const h of hours) {
    if (h.start % HALF_HOUR !== 0 || h.end > now) continue;
    const kwh = round(h.consumption / 2);
    out.push({ starts_at: new Date(h.start).toISOString(), kwh });
    out.push({ starts_at: new Date(h.start + HALF_HOUR).toISOString(), kwh });
  }
  return out;
}

/** Daily readings -> the daily consumption, dated by the local day of their start. */
export function dailyIntervals(days, now, timeZone) {
  return days
    .filter((d) => d.end <= now)
    .map((d) => ({ date: localDate(d.start, timeZone), kwh: round(d.consumption) }));
}

/**
 * The totals of the latest complete local day among `days` (each
 * `{ date, from, to }`) from quarter hours or hours, or undefined.
 */
export function lastCompleteDay(periods, days) {
  for (const day of [...days].reverse()) {
    const inDay = periods.filter((q) => q.start >= day.from && q.end <= day.to);
    const covered = inDay.reduce((s, q) => s + (q.end - q.start), 0);
    if (inDay.length > 0 && covered === day.to - day.from) {
      return {
        date: day.date,
        consumption: round(inDay.reduce((s, q) => s + q.consumption, 0)),
        injection: round(inDay.reduce((s, q) => s + q.injection, 0)),
      };
    }
  }
  return undefined;
}

/** The latest daily reading, or undefined. */
export function lastDayFromDays(dayReadings, timeZone) {
  const last = dayReadings.at(-1);
  return last
    ? {
        date: localDate(last.start, timeZone),
        consumption: last.consumption,
        injection: last.injection,
      }
    : undefined;
}

/**
 * The capacity tariff peak of the latest month Fluvius published:
 * `{ kw, month (YYYY-MM), startsAt }`, or undefined.
 */
export function latestPeak(payload, timeZone) {
  let best;
  for (const month of Array.isArray(payload) ? payload : []) {
    const start = time(month?.d);
    if (start === undefined) continue;
    for (const reading of Array.isArray(month?.v) ? month.v : []) {
      const kw = Number(reading?.v);
      const at = time(reading?.sst);
      if (reading?.v === null || !Number.isFinite(kw) || kw < 0 || at === undefined) continue;
      if (!best || start > best.start || (start === best.start && kw > best.kw)) {
        best = { start, kw: round(kw), at };
      }
    }
  }
  return best
    ? {
        kw: best.kw,
        month: localDate(best.start + 12 * HOUR, timeZone).slice(0, 7),
        startsAt: new Date(best.at).toISOString(),
      }
    : undefined;
}
