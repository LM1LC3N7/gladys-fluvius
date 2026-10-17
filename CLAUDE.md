# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads the **Fluvius** digital meter (Flanders, Belgium) through the
customer portal **Mijn Fluvius**: the Azure AD B2C sign-in of the website
(e-mail and password, PKCE, driven over HTTP), then the readings endpoints of
`mijn.fluvius.be/verbruik/api`. The flow and the meaning of the answers are
ported from
[sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
(MIT, see `THIRD_PARTY_NOTICES.md`). Unofficial: not affiliated with Fluvius.
Sibling of `gladys-octopus-energy` and `gladys-tibber` (same
`publishEnergyConsumption` model).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/model.test.js            # one file
node --test --test-name-pattern "429"     # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        FluviusApp: schedule, readings -> energy monitoring,
                                  plain sensors, errors and retries, test button
src/fluvius/auth.js               the B2C sign-in (MSAL settings, SelfAsserted, code, token)
src/fluvius/api.js                the client: token, readings, 401/429/refusal rules
src/fluvius/model.js              answers -> quarter hours, half hours, days, peak; local time (pure)
src/devices.js                    the devices, feature keys, states (pure)
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js                  endpoints, pacing, manifest keys
src/i18n.js                       runtime texts (en/fr)
src/http.js                       the only HTTP access (cookie jar, no blind redirect, bounded body)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
docs/nl.md                        Dutch documentation (linked from the manifest)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Fluvius keys are forever too**: the external ids `electricity:<EAN>`,
  `gas:<EAN>`, the `FEATURE` keys of `src/devices.js`, the manifest keys.
- **Energy monitoring**: the electricity consumption goes ONLY through
  `publishEnergyConsumption` (dated by Fluvius), never `publishStates`, and
  there is no index feature. The injection never goes into a consumption or
  index feature (it would be billed): it is a plain `unknown` sensor. The gas
  stays OUT of the energy monitoring (the core would price it at the
  electricity tariff) until Gladys handles gas contracts.
- **Be polite with Fluvius**: 4 reads a day, the full window once a day, the
  last 3 days otherwise, one sign-in per expired token, refused credentials
  tried again every 6 hours only, a 429 pauses every call (1 min to 6 h).
- **The password goes to Fluvius only**: every URL must pass `isAllowedUrl`
  (https, `*.fluvius.be`, `*.b2clogin.com`), and the password is posted only
  to the host of the authority or to `*.fluvius.be`. Never log a URL, a body, a
  header, the e-mail, the password, a code or a token.
- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ..., "nl": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code: change both sides
  together.
- **User-facing text**: English and French everywhere (runtime messages,
  manifest, `docs/en.md` / `docs/fr.md`), Dutch in the manifest and
  `docs/nl.md`, kept in sync. Files are UTF-8 without BOM
  (`test/encoding.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
