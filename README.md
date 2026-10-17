# gladys-fluvius

[Gladys Assistant](https://gladysassistant.com) external integration for
**Fluvius** (Flanders, Belgium): the digital meter read through the customer
portal **Mijn Fluvius**, its consumption fed, dated, to the Gladys energy
monitoring, the injection of the last published day and the monthly peak of
the capacity tariff as sensors. **Unofficial, not affiliated with Fluvius.
Never tested on a real account.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md) ·
[docs/nl.md](docs/nl.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (FluviusApp)
                 ├─ src/fluvius/auth.js   Azure AD B2C sign-in over HTTP (PKCE)
                 ├─ src/fluvius/api.js    token, readings, 401 / 429 / refusal rules
                 ├─ src/fluvius/model.js  answers -> quarter hours, half hours, days, peak (pure)
                 ├─ src/devices.js        the devices and their states (pure)
                 └─ src/http.js           the only HTTP access (cookies, no blind redirect, bounded body)
```

- **Sign-in** (as the website does): MSAL settings of `mijn.fluvius.be`, the
  B2C authorize page (`SETTINGS`, `SA_FIELDS`), the e-mail and password posted
  to `SelfAsserted`, the code read from the `confirmed` redirects, exchanged
  with the PKCE verifier. Every URL must stay on `*.fluvius.be` (or
  `*.b2clogin.com`), https only. A page instead of the code (second factor,
  terms, password change) is reported as such; refused credentials are tried
  again every 6 hours only. The token stays in memory.
- **Readings** (`/verbruik/api/meter-measurement-history/<EAN>`, Bearer):
  4 times a day for the created devices only; the last `days_back` days (7 by
  default) once a day, the last 3 days otherwise; detailed = one request per
  local day (quarter hours for electricity, hours for gas), daily = one
  request. Published with `publishEnergyConsumption`: complete half hours
  (two quarters), gas hours split in two, or local days. Upserted by the core,
  so a day read again never counts twice.
- **Monthly peak** (`meter-measurement-spikes`): the latest month published.
- **No index, no billed injection**: the core derives and bills an index; an
  index published a day late would pile a day into one half hour, and an
  injection there would be billed as consumption. The injection and the peak
  are `unknown` sensors (unit in the name).
- **Errors**: 429 → every call paused (Retry-After, 1 min to 6 h); 401 → one
  new sign-in and one retry; 403/404/400 → that meter only; network, 5xx,
  changed login page → retried after 15, 30, 60, then every 120 minutes.
  Bodies are read up to 1 MiB.

## Credits

The sign-in flow, the endpoints and the meaning of the readings are ported
from
[sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
(MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Modelled on the
sibling integrations [gladys-tibber](https://github.com/LM1LC3N7/gladys-tibber)
and [gladys-octopus-energy](https://github.com/LM1LC3N7/gladys-octopus-energy).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the B2C pages and the readings are synthetic,
shaped after the reference project's tests and code. Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The logic ported from sander110419/Fluvius-home-assistant
remains under its MIT license, reproduced in full in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the Docker image).
