# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real personal Mijn Fluvius account
      (electricity with solar panels, gas, with and without quarter-hour
      readings): sign-in, test button, devices, the 30-minute and daily
      consumption in the energy monitoring, the injection and peak sensors.
- [ ] Test the Docker image (no Docker on the development PC yet).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real account (built without one)

- [ ] The B2C flow still matches the reference (MSAL settings shape,
      `SETTINGS` / `SA_FIELDS`, SelfAsserted answer `{ status: "200" }`,
      `confirmed` redirecting with the code) and works without the `Origin`
      header on the token request, as the reference does.
- [ ] The tenant host of the login page is the authority host
      (`login.fluvius.be`) or a `fluvius.be` one: the password is refused
      anywhere else.
- [ ] What a login with two-step verification shows at the `confirmed`
      step (a page, as assumed, or a redirect with `error=`).
- [ ] The cookies the B2C pages set are enough with this small jar (host and
      `Domain` attributes only, no path matching).
- [ ] The lifetime of the access token (`expires_in`), and whether Fluvius
      throttles 4 password sign-ins a day.
- [ ] The `d` / `de` of the quarter hours are UTC instants with `Z` (as in
      the reference tests); hours with an offset parse too, a date-time
      without offset is read as UTC.
- [ ] `meter-measurement-spikes` answers one period per month with its peak;
      the latest month is the current one (or the previous one early in a
      month); its answer when there is no data yet (empty list assumed: the
      previous peak is kept).
- [ ] The electricity consumption feature is attached by the core to the
      main electric meter (or is the main meter itself) as expected.
- [ ] The behaviour on a reconnection to Gladys (`disconnected` then
      `connected`): the client, its token and the 429 pause are kept, the
      meters' state too (no full window read again the same day).
- [ ] A gas daily reading starts at 06:00 local time (dated by that day).
- [ ] The answer of a meter of another account, or of a wrong serial number
      (403, 404 or 400 assumed).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag), as for the sibling integrations; the
  Release workflow owns them from now on (the first patch release gives
  0.1.1).
- **Reused project**: no JavaScript Fluvius client exists; the HTTP sign-in
  and the reading logic of sander110419/Fluvius-home-assistant (MIT, by
  sander110419, commit 183700a) are ported and credited
  (`THIRD_PARTY_NOTICES.md`, README, docs). Its LICENSE file names "HACS"
  (the template it started from) as copyright holder: reproduced as it
  appears. The SDK stays the only runtime dependency (PKCE with
  `node:crypto`, a tiny cookie jar in `src/http.js`).
- **Two-step verification**: the reference project handles none and Fluvius
  does not require it for personal accounts (it only says professional
  accounts need itsme/eID). If the login asks for one, the integration says
  so (`interaction_required`) and tries again every 6 hours; it never asks
  for a code.
- **Password sign-in only, token in memory**: no refresh token is used (the
  reference signs in again when the token expires); with 4 reads a day, that
  is about 4 sign-ins a day, far below the reference (hourly). The client is
  kept while the e-mail and the password stay the same (reconnection, saving
  the form), so its token and refusal delay survive. Nothing is written
  outside the config.
- **Hosts allowed**: https only, `*.fluvius.be` and `*.b2clogin.com` for
  every request; the password is posted only to the host of the MSAL
  authority or to `*.fluvius.be`. The authority, the tenant of the page and
  every redirect are checked before any request.
- **Gas out of the energy monitoring (v0.1, coordinator decision)**: a gas
  consumption published there would be attached to the main electric meter
  and priced at the electricity tariff (the core refuses gas contracts in
  v1). The gas device only has `consumption_last_day` (plain sensor, daily
  readings).
- **Energy monitoring (electricity)**: through `publishEnergyConsumption`
  (Gladys >= 5.2.0): `thirty-minutes-consumption` from complete half hours
  (two quarter hours) or `daily-consumption` by local date. No index feature
  (the core would derive a consumption from it, and an index published a day
  late piles a whole day into one half hour).
- **Injection**: the core has production types
  (`energy-production-sensor`), but `publishEnergyConsumption` only takes an
  `energy-sensor` consumption, and a production index published late would
  have the same problem as above. So the injection is a plain sensor
  (`unknown` / `decimal`, no unit: the core lists none for `unknown`, kWh in
  the name), the total of the latest complete day: never billed.
- **Capacity peak**: plain sensor too (`unknown` / `decimal`, kW in the
  name) rather than `energy-sensor` / `power`: a month's peak published late
  must not be taken for a live power by the energy contracts. Read after the
  consumption is published; only the errors that stop every call
  (`rate_limited`, `bad_credentials`, `interaction_required`,
  `no_credentials`, `token_refused`) go up, any other failure keeps the
  previous peak.
- **Resolution (electricity only)**: one consumption feature per device,
  different keys (`consumption`, `daily_consumption`) because the type is
  fixed at creation. The readings follow the feature of the CREATED device
  (from `gladys.devices` or the creation event); a configuration that
  differs is shown in the status until the device is created again.
- **Schedule**: every 6 hours, plus at start (not awaited: a save of the
  form answers at once) and at the creation of a device; the full window
  (`days_back`, 7 by default, 3 to 31) once per local day, the last 3 days
  otherwise; detailed = one request per local day as the reference. Only
  created devices are read. The meters' state (last day, peak, full read of
  the day) survives a restart with the same EAN and serial.
- **Errors**: 429 → every call paused (Retry-After bounded to 1 min .. 6 h,
  15 min without it), the pause held by the application and shared with
  every client, the integration retries at the end of the pause; 401 on a
  reading → one new sign-in and one retry, never when the token was obtained
  by that same call (`token_refused` at once); refused credentials and
  `interaction_required` → the same error for 6 hours without any call;
  `token_refused` and `login_changed` → next try in 6 hours with their own
  status; 403 / 404 / 400 → that meter only, shown in the status; others →
  retry after 15, 30, 60, then 120 minutes. The regular 6-hour poll stays
  armed whatever happens.
- **Hostile answers**: bodies read up to 1 MiB (stream cut beyond), at most 6
  redirects, the `SETTINGS` / `SA_FIELDS` objects found with `indexOf` only
  (every occurrence of `var NAME` tried, 20 at most), at most 50 cookies per
  answer.
- **EAN and serial number** are plain text fields (they are also shown in
  the device params); the EAN must have 18 digits, the serial number is
  required with it.
- **Dutch**: manifest texts and `docs/nl.md` in Dutch (the store indexes only
  en/fr/de/es docs, so `docs/nl.md` is linked from the configuration screen);
  runtime messages in English and French like the other integrations.
- **Time zone**: Europe/Brussels for the days and request bounds; the docs
  ask for a Gladys time zone with the same clock (Brussels, Paris,
  Amsterdam) so that daily values land on the right day.

## Ideas

- Gas in the energy monitoring once the core handles gas contracts (hourly
  readings split in half hours are already in `src/fluvius/model.js`).
- Several meters of each kind (a list of EANs).
- Read the meters of the account automatically, if Mijn Fluvius exposes a
  list endpoint.
- The capacity peak of each month as history, and a scene trigger when a new
  monthly peak is published.
