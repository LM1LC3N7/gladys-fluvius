// -----------------------------------------------------------------------------
// The meaning of the Mijn Fluvius answers (pure functions), on sample answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyIntervals,
  daysBefore,
  daysOf,
  energyOf,
  halfHoursFromHours,
  halfHoursFromQuarters,
  historyRange,
  hoursOf,
  isoLocal,
  lastCompleteDay,
  lastDayFromDays,
  latestPeak,
  quartersOf,
  time,
} from '../src/fluvius/model.js';
import { NOW, SPIKES, TZ, gasHours, quarters } from './fixtures/fluvius.js';

const H = 60 * 60_000;

test('an instant without offset is UTC, whatever the machine time zone', () => {
  const utc = Date.parse('2026-10-14T22:00:00Z');
  assert.equal(time('2026-10-14T22:00:00'), utc);
  assert.equal(time('2026-10-14T22:00:00.000'), utc);
  assert.equal(time('2026-10-14T22:00:00Z'), utc);
  assert.equal(time('2026-10-15T00:00:00+02:00'), utc);
  assert.equal(time('nope'), undefined);
  assert.equal(time(12), undefined);
  const [q] = quartersOf([
    { d: '2026-10-14T22:00:00', de: '2026-10-14T22:15:00', v: [{ t: 1, v: 1, u: 3 }] },
  ]);
  assert.equal(q.start, utc);
});

test('a reading: t is the direction, dc the register, only kWh count (as the reference)', () => {
  // The case of the reference test `test_direction_mapping_handles_tariffs`.
  assert.deepEqual(
    energyOf({
      v: [
        { dc: 1, t: 1, v: 8.0, u: 3 },
        { dc: 1, t: 2, v: 2.0, u: 3 },
        { dc: 2, t: 1, v: 4.5, u: 3 },
        { dc: 2, t: 2, v: 1.25, u: 3 },
      ],
    }),
    { consumption: 12.5, injection: 3.25 },
  );
  // Gas: the m³ duplicate is dropped, the kWh kept (`test_gas_day_uses_kwh_values_only`).
  assert.deepEqual(
    energyOf({
      v: [
        { dc: 0, t: 1, v: 5.083, u: 5 },
        { dc: 0, t: 1, v: 57.9398, u: 3 },
      ],
    }),
    { consumption: 57.9398, injection: 0 },
  );
  // Negative, null, unknown register or direction: ignored; nothing left: no period.
  assert.equal(
    energyOf({
      v: [
        { dc: 1, t: 1, v: -1, u: 3 },
        { dc: 1, t: 1, v: null, u: 3 },
        { dc: 7, t: 1, v: 1, u: 3 },
        { dc: 1, t: 9, v: 1, u: 3 },
      ],
    }),
    undefined,
  );
});

test('quarter hours become complete half hours of consumption only, never in the future', () => {
  const from = Date.parse('2026-10-14T22:00:00Z');
  const payload = quarters(from, from + 2 * H);
  // A half hour with one quarter missing, and a quarter that is not 15 minutes long.
  payload.splice(5, 1);
  payload.push({
    d: '2026-10-15T01:00:00Z',
    de: '2026-10-15T02:00:00Z',
    v: [{ t: 1, v: 9, u: 3 }],
  });
  const halves = halfHoursFromQuarters(quartersOf(payload), NOW);
  assert.deepEqual(
    halves.map((h) => h.starts_at),
    [
      '2026-10-14T22:00:00.000Z',
      '2026-10-14T22:30:00.000Z',
      // 23:00 lost one quarter: left out until Fluvius completes it.
      '2026-10-14T23:30:00.000Z',
    ],
  );
  // 0.1 + 0.1 kWh offtake; the 0.02 kWh injections are never added.
  assert.ok(halves.every((h) => h.kwh === 0.2));
  // A half hour that is not over yet is never published.
  const late = quartersOf(quarters(NOW - 15 * 60_000, NOW + 15 * 60_000));
  assert.deepEqual(halfHoursFromQuarters(late, NOW), []);
});

test('gas hours are split into two equal half hours, in kWh', () => {
  const from = Date.parse('2026-10-14T22:00:00Z');
  const halves = halfHoursFromHours(hoursOf(gasHours(from, from + 2 * H)), NOW);
  assert.deepEqual(halves, [
    { starts_at: '2026-10-14T22:00:00.000Z', kwh: 0.6 },
    { starts_at: '2026-10-14T22:30:00.000Z', kwh: 0.6 },
    { starts_at: '2026-10-14T23:00:00.000Z', kwh: 0.6 },
    { starts_at: '2026-10-14T23:30:00.000Z', kwh: 0.6 },
  ]);
});

test('a daily reading is dated by the local day of its start (gas days start at 06:00)', () => {
  const readings = daysOf([
    { d: '2026-10-14T04:00:00Z', de: '2026-10-15T04:00:00Z', v: [{ dc: 0, t: 1, v: 30, u: 3 }] },
    { d: '2026-10-14T22:00:00Z', de: '2026-10-15T22:00:00Z', v: [{ dc: 1, t: 1, v: 9, u: 3 }] },
    // Not over yet: not published.
    { d: '2026-10-15T22:00:00Z', de: '2026-10-16T22:00:00Z', v: [{ dc: 1, t: 1, v: 1, u: 3 }] },
  ]);
  assert.deepEqual(dailyIntervals(readings, NOW, TZ), [
    { date: '2026-10-14', kwh: 30 },
    { date: '2026-10-15', kwh: 9 },
  ]);
  assert.equal(lastDayFromDays(readings, TZ).date, '2026-10-16');
});

test('request bounds are local times with their offset, summer and winter', () => {
  assert.equal(isoLocal(Date.parse('2026-10-15T22:00:00Z'), TZ), '2026-10-16T00:00:00.000+02:00');
  assert.equal(
    isoLocal(Date.parse('2026-12-01T10:30:00.250Z'), TZ),
    '2026-12-01T11:30:00.250+01:00',
  );
  const [day] = daysBefore(NOW, 1, TZ);
  assert.deepEqual(historyRange(day.from, day.to, TZ), {
    historyFrom: '2026-10-15T00:00:00.000+02:00',
    historyUntil: '2026-10-15T23:59:59.999+02:00',
  });
});

test('the days before today, oldest first, a DST day lasting 25 hours', () => {
  const list = daysBefore(Date.parse('2026-10-27T09:00:00Z'), 3, TZ);
  assert.deepEqual(
    list.map((d) => d.date),
    ['2026-10-24', '2026-10-25', '2026-10-26'],
  );
  assert.deepEqual(
    list.map((d) => (d.to - d.from) / H),
    [24, 25, 24],
  );
  // The last complete day needs every quarter hour of it: 100 on that day.
  const dst = list[1];
  const all = quartersOf(quarters(dst.from, dst.to));
  assert.equal(all.length, 100);
  assert.equal(lastCompleteDay(all, list).date, '2026-10-25');
  assert.equal(lastCompleteDay(all.slice(1), list), undefined);
  const totals = lastCompleteDay(all, list);
  assert.equal(totals.consumption, 10);
  assert.equal(totals.injection, 2);
});

test('the capacity peak is the highest of the latest month published', () => {
  assert.deepEqual(latestPeak(SPIKES, TZ), {
    kw: 3.456,
    month: '2026-10',
    startsAt: '2026-10-07T18:15:00.000Z',
  });
  assert.equal(latestPeak([], TZ), undefined);
  assert.equal(latestPeak([{ d: 'nope', v: [{ v: 1, sst: 'x' }] }], TZ), undefined);
});
