# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Sign-in to Mijn Fluvius with the e-mail and password of a personal account
  (the Azure AD B2C flow of the website, over HTTP), ported from
  sander110419/Fluvius-home-assistant. A login asking for a second factor or
  another browser step is reported, never retried in a loop.
- One device per configured meter (electricity and/or gas, by EAN): the
  consumption fed, dated, to the Gladys energy monitoring with
  `publishEnergyConsumption` (Gladys 5.2+), by half hour from the quarter-hour
  (electricity) or hourly (gas) readings, or by day.
- Plain sensors: the consumption and the injection of the latest complete day
  published, and the monthly peak of the capacity tariff (kW). The injection
  is never counted as consumption.
- Four reads a day; the last days read again once a day (7 by default, up to 31) to catch late or corrected readings, the last 3 days otherwise.
- Resilience: passing failures retried after 15, 30, 60, then every 120
  minutes; refused credentials retried every 6 hours only; a 429 pauses every
  call (1 minute to 6 hours); a 401 signs in again once.
- "Test the connection" button: signs in and reads yesterday's total of each
  meter.
- Documentation in English, French and Dutch; `THIRD_PARTY_NOTICES.md` with
  the MIT license of sander110419/Fluvius-home-assistant, shipped in the
  image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-fluvius/commits/main
