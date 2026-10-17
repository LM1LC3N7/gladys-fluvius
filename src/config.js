// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

export const RESOLUTION = { DETAILED: 'detailed', DAILY: 'daily' };

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  resolution: RESOLUTION.DETAILED,
  days_back: 7,
};

export const DAYS_BACK = { min: 3, max: 31 };

const text = (value) => (typeof value === 'string' ? value.trim() : '');
/** An EAN or a serial number as printed, spaces and dots removed. */
const id = (value) => text(value).replace(/[\s.]+/g, '');

const number = (value, fallback, min, max) => {
  const n = Number(value);
  return value !== '' && value !== null && value !== undefined && Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : fallback;
};

export function normalizeConfig(raw = {}) {
  const meters = [];
  for (const kind of ['electricity', 'gas']) {
    const ean = id(raw[`${kind}_ean`]);
    const serial = id(raw[`${kind}_serial`]);
    if (ean) {
      meters.push({ kind, ean, serial });
    }
  }
  return {
    email: text(raw.email),
    // A password is taken as typed: spaces may belong to it.
    password: typeof raw.password === 'string' ? raw.password : '',
    meters,
    resolution: raw.resolution === RESOLUTION.DAILY ? RESOLUTION.DAILY : RESOLUTION.DETAILED,
    daysBack: number(raw.days_back, DEFAULTS.days_back, DAYS_BACK.min, DAYS_BACK.max),
  };
}
