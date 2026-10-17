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
- [ ] What a login with two-step verification shows at the `confirmed`
      step (a page, as assumed, or a redirect with `error=`).
- [ ] The cookies the B2C pages set are enough with this small jar (host and
      `Domain` attributes only, no path matching).
- [ ] The lifetime of the access token (`expires_in`), and whether Fluvius
      throttles 4 password sign-ins a day.
- [ ] The `d` / `de` of the quarter hours are UTC instants with `Z` (as in
      the reference tests); hours with an offset parse too.
- [ ] `meter-measurement-spikes` answers one period per month with its peak;
      the latest month is the current one (or the previous one early in a
      month).
- [ ] A gas daily reading starts at 06:00 local time (dated by that day).
- [ ] The answer of a meter of another account, or of a wrong serial number
      (403, 404 or 400 assumed).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag), as for the sibling integrations; the
  Release workflow owns them from now on (the first patch release gives
  0.1.1).
- **Reused project**: no JavaScript Fluvius client exists; the HTTP sign-in
  and the reading logic of sander110419/Fluvius-home-assistant (MIT, the
  project the brief named) are ported and credited (`THIRD_PARTY_NOTICES.md`,
  README, docs). Its LICENSE file names "HACS" (the template it started from)
  as copyright holder: reproduced as is. The SDK stays the only runtime
  dependency (PKCE with `node:crypto`, a tiny cookie jar in `src/http.js`).
- **Two-step verification**: the reference project handles none and Fluvius
  does not require it for personal accounts (it only says professional
  accounts need itsme/eID). If the login asks for one, the integration says
  so (`interaction_required`) and tries again every 6 hours; it never asks
  for a code.
- **Password sign-in only, token in memory**: no refresh token is used (the
  reference signs in again when the token expires); with 4 reads a day, that
  is about 4 sign-ins a day, far below the reference (hourly). Nothing is
  written outside the config.
- **Hosts allowed**: https only, `*.fluvius.be` and `*.b2clogin.com`; the
  MSAL authority, the tenant of the page and every redirect are checked
  before any request, so the password can only reach Fluvius.
- **Energy monitoring**: the consumption only, through
  `publishEnergyConsumption` (Gladys >= 5.2.0): `thirty-minutes-consumption`
  from complete half hours (two quarter hours; gas hours split in two equal
  halves, as the SDK advises) or `daily-consumption` by local date. No index
  feature (the core would derive a consumption from it, and an index
  published a day late piles a whole day into one half hour).
- **Injection**: the core has production types
  (`energy-production-sensor`), but `publishEnergyConsumption` only takes an
  `energy-sensor` consumption, and a production index published late would
  have the same problem as above. So the injection is a plain sensor
  (`unknown` / `decimal`, no unit: the core lists none for `unknown`, kWh in
  the name), the total of the latest complete day: never billed.
- **Capacity peak**: plain sensor too (`unknown` / `decimal`, kW in the
  name) rather than `energy-sensor` / `power`: a month's peak published late
  must not be taken for a live power by the energy contracts.
- **Resolution**: one consumption feature per device, chosen in the
  configuration (`detailed` or `daily`), different keys (`consumption`,
  `daily_consumption`) because the type is fixed at creation. Changing it
  later needs the devices deleted and created again (documented; a 400 from
  Gladys is logged).
- **Schedule**: every 6 hours, plus at start and at the creation of a device;
  the full window (`days_back`, 7 by default, 3 to 31) once per local day,
  the last 3 days otherwise; detailed = one request per local day as the
  reference. Only created devices are read.
- **Errors**: 429 → every call of the client paused (Retry-After bounded to
  1 min .. 6 h, 15 min without it), the integration retries at the end of the
  pause; 401 on a reading → one new sign-in and one retry, then
  `token_refused`; refused credentials and `interaction_required` → the same
  error for 6 hours without any call; 403 / 404 / 400 → that meter only,
  shown in the status; others → retry after 15, 30, 60, then 120 minutes. The
  regular 6-hour poll stays armed whatever happens.
- **Hostile answers**: bodies read up to 1 MiB (stream cut beyond), at most 6
  redirects, the `SETTINGS` / `SA_FIELDS` objects found with two `indexOf`
  (linear), at most 50 cookies per answer.
- **EAN and serial number** are plain text fields (they are also shown in
  the device params); the EAN must have 18 digits.
- **Dutch**: manifest texts and `docs/nl.md` in Dutch (the store indexes only
  en/fr/de/es docs, so `docs/nl.md` is linked from the configuration screen);
  runtime messages in English and French like the other integrations.
- **Time zone**: Europe/Brussels for the days and request bounds, whatever
  the Gladys time zone; half hours are absolute instants.

## Ideas

- Several meters of each kind (a list of EANs).
- Read the meters of the account automatically, if Mijn Fluvius exposes a
  list endpoint.
- The capacity peak of each month as history, and a scene trigger when a new
  monthly peak is published.
