// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// External ids (forever):
//   electricity:<EAN>   the electricity connection point
//   gas:<EAN>           the gas connection point
// The EAN (the 18-digit code of the connection point) is the stable id: a
// replaced meter (new serial number) keeps the same device and its history.
//
// Energy monitoring rules (Gladys core):
// - the consumption is dated by Fluvius and published after the fact with
//   publishEnergyConsumption, on a `thirty-minutes-consumption` feature
//   (detailed readings) or a `daily-consumption` one (daily readings), never
//   through publishStates, and there is NO index feature (an index published
//   a day late would pile a whole day into one half hour);
// - the injection is never put in a consumption or index feature (it would
//   be billed as consumption): the core has no dated production path for an
//   integration, so it is a plain sensor, without effect on the bill;
// - the monthly peak of the capacity tariff is a plain sensor too: an
//   `energy-sensor` power value published late could be taken for a live
//   power by the energy contracts.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { RESOLUTION } from './config.js';

export const KIND = { ELECTRICITY: 'electricity', GAS: 'gas' };

/** Feature keys (forever). */
export const FEATURE = {
  CONSUMPTION: 'consumption',
  DAILY_CONSUMPTION: 'daily_consumption',
  INJECTION_LAST_DAY: 'injection_last_day',
  CONSUMPTION_LAST_DAY: 'consumption_last_day',
  CAPACITY_PEAK: 'capacity_peak',
};

export const ids = (gladys, kind, ean) => gladys.externalIds(kind, String(ean));

/** The consumption feature key of a resolution. */
export const consumptionKey = (resolution) =>
  resolution === RESOLUTION.DAILY ? FEATURE.DAILY_CONSUMPTION : FEATURE.CONSUMPTION;

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: 1_000_000,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (external, key, name, max) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.DECIMAL, { max });

export function buildMeterDevice(gladys, meter, resolution) {
  const external = ids(gladys, meter.kind, meter.ean);
  const gas = meter.kind === KIND.GAS;
  const daily = resolution === RESOLUTION.DAILY;
  const features = [
    feature(
      external,
      consumptionKey(resolution),
      daily ? 'Consumption (day)' : 'Consumption (30 min)',
      C.ENERGY_SENSOR,
      daily ? T.ENERGY_SENSOR.DAILY_CONSUMPTION : T.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION,
      { unit: U.KILOWATT_HOUR, max: daily ? 100_000 : 10_000 },
    ),
    plain(external, FEATURE.CONSUMPTION_LAST_DAY, 'Consumption, last published day (kWh)', 100_000),
  ];
  if (!gas) {
    features.push(
      plain(external, FEATURE.INJECTION_LAST_DAY, 'Injection, last published day (kWh)', 100_000),
      plain(external, FEATURE.CAPACITY_PEAK, 'Monthly peak, capacity tariff (kW)', 1000),
    );
  }
  return {
    name: `Fluvius ${gas ? 'gas' : 'electricity'} (EAN …${meter.ean.slice(-4)})`,
    external_id: external.device,
    features,
    params: [
      { name: 'ean', value: meter.ean },
      { name: 'meter_serial', value: meter.serial },
      { name: 'resolution', value: daily ? RESOLUTION.DAILY : RESOLUTION.DETAILED },
    ],
  };
}

const state = (external, key, value) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? []
    : [
        {
          device_feature_external_id: external.feature(key),
          state: Math.round(value * 1000) / 1000,
        },
      ];

/** The plain sensors of a meter: last published day, monthly peak. */
export function meterStates(external, { lastDay, peak }) {
  return [
    ...state(external, FEATURE.CONSUMPTION_LAST_DAY, lastDay?.consumption),
    ...state(external, FEATURE.INJECTION_LAST_DAY, lastDay?.injection),
    ...state(external, FEATURE.CAPACITY_PEAK, peak?.kw),
  ];
}
