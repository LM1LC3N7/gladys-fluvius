# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-17

### Added

- Sign-in to Mijn Fluvius with the e-mail and password of a personal account
  (the Azure AD B2C flow of the website, over HTTP), ported from
  sander110419/Fluvius-home-assistant. A login asking for a second factor or
  another browser step is reported, never retried in a loop.
- One device per configured meter (by EAN). Electricity: the consumption
  fed, dated, to the Gladys energy monitoring with `publishEnergyConsumption`
  (Gladys 5.2+), by half hour from the quarter-hour readings, or by day; the
  consumption and the injection of the latest complete day published and the
  monthly peak of the capacity tariff (kW) as plain sensors. The injection is
  never counted as consumption.
- Gas: the total of the latest day published, as a plain sensor. The gas
  stays out of the energy monitoring until Gladys handles gas contracts (it
  would be priced at the electricity tariff).
- Four reads a day; the last days read again once a day (7 by default, up
  to 31) to catch late or corrected readings, the last 3 days otherwise.
- Resilience: passing failures retried after 15, 30, 60, then every 120
  minutes; refused credentials, a refused fresh token or a changed login
  page retried every 6 hours only (saving the form or the test button tries
  at once); a 429 pauses every call (1 minute to 6 hours), even across
  reconnections; a 401 signs in again once; a 403 or 408 of the login pages
  is a passing failure.
- "Test the connection" button: signs in and reads yesterday's total of each
  meter.
- Documentation in English, French and Dutch; `THIRD_PARTY_NOTICES.md` with
  the MIT license of sander110419/Fluvius-home-assistant, shipped in the
  image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-fluvius/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-fluvius/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-fluvius/releases/tag/v0.1.1
