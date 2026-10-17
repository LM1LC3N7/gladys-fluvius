// -----------------------------------------------------------------------------
// The Mijn Fluvius client: an access token (a sign-in when there is none or it
// expired), and the readings of a meter (`meter-measurement-history`, the
// monthly peaks `meter-measurement-spikes`), as the reference project calls
// them: EAN in the path, meter serial number and `asServiceProvider=false` in
// the query, Bearer token.
//
// Safety rules (no loop, no burst):
// - concurrent callers share one sign-in;
// - a 401 on a reading drops the token, signs in ONCE and retries ONCE;
// - refused credentials (or a login asking for a browser step) are not tried
//   again before CREDENTIALS_RETRY: every caller gets the same error at once;
// - a 429 anywhere pauses EVERY call of the client (bounded 1 min .. 6 h).
// -----------------------------------------------------------------------------

import {
  CREDENTIALS_RETRY,
  HISTORY_URL,
  RATE_LIMIT_MAX,
  RATE_LIMIT_MIN,
  RATE_LIMIT_PAUSE,
  SPIKES_URL,
} from '../constants.js';
import { FluviusError, dataError, parseJson, send } from '../http.js';
import { authenticate as defaultAuthenticate } from './auth.js';

const BLOCKING = new Set(['bad_credentials', 'interaction_required', 'no_credentials']);

export class FluviusClient {
  constructor({
    email = '',
    password = '',
    now = Date.now,
    authenticate = defaultAuthenticate,
    pause = { until: 0 },
  } = {}) {
    this.email = email;
    this.password = password;
    this.now = now;
    this.authenticate = authenticate;
    this.token = '';
    this.tokenExpires = 0;
    this.signingIn = undefined;
    /** { until, error }: the last refusal, repeated without a call until `until`. */
    this.blocked = undefined;
    /** The 429 pause, an object the application keeps across restarts and clients. */
    this.pause = pause;
  }

  get pausedUntil() {
    return this.pause.until;
  }

  set pausedUntil(value) {
    this.pause.until = value;
  }

  paused() {
    return this.now() < this.pausedUntil;
  }

  pauseError() {
    const error = new FluviusError('rate_limited', 'Fluvius asked to slow down (429)', 429);
    error.retryAfter = Math.max(0, this.pausedUntil - this.now());
    return error;
  }

  /** Run a call; a 429 pauses every later call of the client. */
  async guarded(job) {
    if (this.paused()) {
      throw this.pauseError();
    }
    try {
      return await job();
    } catch (err) {
      if (err instanceof FluviusError && err.code === 'rate_limited') {
        const pause = Math.min(
          RATE_LIMIT_MAX,
          Math.max(RATE_LIMIT_MIN, err.retryAfter ?? RATE_LIMIT_PAUSE),
        );
        this.pausedUntil = this.now() + pause;
        err.retryAfter = pause;
      }
      throw err;
    }
  }

  // --- Token -----------------------------------------------------------------------

  /** A valid access token: the known one, else one sign-in shared by the callers. */
  async accessToken() {
    if (this.token && this.now() < this.tokenExpires) {
      return this.token;
    }
    return this.signIn();
  }

  signIn() {
    if (this.signingIn) {
      return this.signingIn;
    }
    if (this.blocked && this.now() < this.blocked.until) {
      return Promise.reject(this.blocked.error);
    }
    this.signingIn = this.doSignIn().finally(() => {
      this.signingIn = undefined;
    });
    return this.signingIn;
  }

  async doSignIn() {
    this.token = '';
    let tokens;
    try {
      tokens = await this.guarded(() => this.authenticate(this.email, this.password));
    } catch (err) {
      if (err instanceof FluviusError && BLOCKING.has(err.code)) {
        this.blocked = { until: this.now() + CREDENTIALS_RETRY, error: err };
      }
      throw err;
    }
    this.blocked = undefined;
    const lifetime = Number(tokens.expires_in);
    // A minute of margin, as the reference does; 1 hour when Fluvius does not say.
    const seconds = Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600;
    this.token = tokens.access_token;
    this.tokenExpires = this.now() + Math.max(0, seconds - 60) * 1000;
    return this.token;
  }

  // --- Readings ----------------------------------------------------------------------

  /** GET a reading list with the token; a 401 signs in once and retries once. */
  async readings(baseUrl, ean, serial, params) {
    const url = new URL(`${baseUrl}/${encodeURIComponent(ean)}`);
    for (const [key, value] of Object.entries({
      ...params,
      asServiceProvider: 'false',
      meterSerialNumber: serial,
    })) {
      url.searchParams.set(key, value);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // A token obtained by this very call and refused at once: signing in
      // again would only be refused again.
      const known = Boolean(this.token) && this.now() < this.tokenExpires;
      const token = await this.accessToken();
      if (!known) {
        attempt = 1;
      }
      const response = await this.guarded(() =>
        send(url.href, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }),
      );
      if (response.status === 200) {
        const body = parseJson(response.text);
        if (!Array.isArray(body)) {
          throw new FluviusError('http', 'Fluvius answered something that is not a list');
        }
        return body;
      }
      if (response.status === 401) {
        this.token = '';
        if (attempt === 0) {
          continue;
        }
        throw new FluviusError('token_refused', 'Fluvius refused a fresh access token (401)', 401);
      }
      throw dataError(response.status);
    }
    throw new FluviusError('token_refused', 'Fluvius refused a fresh access token (401)', 401);
  }

  /** `params`: historyFrom, historyUntil, granularity. */
  history(ean, serial, params) {
    return this.readings(HISTORY_URL, ean, serial, params);
  }

  /** `params`: historyFrom, historyUntil. */
  spikes(ean, serial, params) {
    return this.readings(SPIKES_URL, ean, serial, params);
  }
}
