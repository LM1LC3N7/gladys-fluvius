// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// feature keys) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection' };

/** The Mijn Fluvius time zone: days, quarter hours and request bounds follow it. */
export const TIME_ZONE = 'Europe/Brussels';

// --- Mijn Fluvius endpoints (as sander110419/Fluvius-home-assistant uses them) ---
export const MSAL_CONFIG_URL = 'https://mijn.fluvius.be/api/global/msal/config';
export const DEFAULT_AUTHORITY =
  'https://login.fluvius.be/klanten.onmicrosoft.com/B2C_1A_customer_signup_signin';
export const DEFAULT_REDIRECT_URI = 'https://mijn.fluvius.be/';
export const DEFAULT_SCOPE = 'https://klanten.onmicrosoft.com/MijnFluvius/user_impersonation';
export const HISTORY_URL = 'https://mijn.fluvius.be/verbruik/api/meter-measurement-history';
export const SPIKES_URL = 'https://mijn.fluvius.be/verbruik/api/meter-measurement-spikes';

/** Codes of the `granularity` parameter of meter-measurement-history. */
export const GRANULARITY = { QUARTER_HOUR: '1', HOUR: '2', DAY: '4' };
/** Unit code of a reading: 3 = kWh (5 = m³, never used: the energy monitoring is in kWh). */
export const UNIT_KWH = 3;

// The login pages are a browser's: the same User-Agent as the reference project.
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const HTTP_TIMEOUT = 20_000;
/** A login page, a token or a month of readings is far below this: more is hostile. */
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_REDIRECTS = 6;

// --- Schedule ------------------------------------------------------------------
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Fluvius publishes the readings of a day the next day or later: 4 reads a day. */
export const POLL_INTERVAL = 6 * HOUR;
/** Outside the daily full read, only these last days are read again. */
export const RECENT_DAYS = 3;
/** After a passing failure: new tries after 15, 30, 60, then every 120 minutes. */
export const RETRY_BACKOFF = [15 * MINUTE, 30 * MINUTE, 60 * MINUTE, 120 * MINUTE];
/** Refused credentials (or a login asking for a browser step): one try every 6 hours. */
export const CREDENTIALS_RETRY = 6 * HOUR;
/** 429: every call waits, between 1 minute and 6 hours whatever Retry-After says. */
export const RATE_LIMIT_PAUSE = 15 * MINUTE;
export const RATE_LIMIT_MIN = MINUTE;
export const RATE_LIMIT_MAX = 6 * HOUR;
/** The test button answers within this delay. */
export const TEST_ANSWER_WITHIN = 50_000;
/** publishEnergyConsumption takes at most 2,000 intervals per call. */
export const MAX_INTERVALS_PER_CALL = 2000;
