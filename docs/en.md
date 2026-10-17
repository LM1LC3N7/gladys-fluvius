# Fluvius (Flanders) for Gladys

Unofficial integration, **not affiliated with Fluvius**. It reads your
digital meter in Flanders through your **Mijn Fluvius** customer account and
feeds its consumption to the Gladys energy monitoring.

> **Never tested on a real Mijn Fluvius account.** It is built from the
> project [sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
> (whose author tested it live) and from sample answers. Please report what
> works and what does not on the Gladys forum.

## What you get

One device per meter you enter (electricity and/or gas):

- **Consumption (30 min)** or **Consumption (day)**: fed to the **energy
  monitoring** of Gladys, dated by Fluvius; the costs of your energy contract
  are computed on it.
- **Consumption, last published day (kWh)**: the total of the latest complete
  day Fluvius published, for a dashboard.
- **Injection, last published day (kWh)**: electricity only; what you sent to
  the grid (solar panels) that day. **Shown only**: never counted as
  consumption nor billed.
- **Monthly peak, capacity tariff (kW)**: electricity only; the highest
  quarter-hour average power of the latest month Fluvius published, the base
  of the Flemish capacity tariff.

Fluvius publishes the readings **after the fact**, usually the next day,
sometimes later, and corrects some. The integration reads Mijn Fluvius
**4 times a day**: once a day it reads again the last days (7 by default),
the other times the last 3 days. Gladys keeps one value per half hour (or per
day): a reading read again or corrected never counts twice.

## Before you start

- Gladys **5.2.0 or newer** (dated consumption of the energy monitoring).
- A **personal** Mijn Fluvius account that signs in with an e-mail and a
  password. Professional accounts (itsme / eID) cannot be used.
- **Two-step verification**: the integration cannot type a code. If your
  sign-in asks for one (or for new terms, or a password change), the
  integration says so in its status: sign in once on
  [mijn.fluvius.be](https://mijn.fluvius.be/) in a browser, or turn the
  two-step verification off if Fluvius lets you.
- The **EAN** (18 digits, starts with 54) and the **serial number** of each
  meter: both are shown in Mijn Fluvius and on your bills.
- For the detailed readings: turn the **quarter-hour readings** (electricity)
  or **hourly readings** (gas) on in Mijn Fluvius. Otherwise, choose the daily
  readings.

## Setup

1. Install the integration from the Gladys store.
2. Fill in the e-mail and the password of Mijn Fluvius, then the EAN and the
   serial number of your electricity meter and/or your gas meter.
3. Choose the readings: **detailed** (quarter hours, sent by half hour) or
   **daily**. Choose before creating the devices: the type of the consumption
   feature is fixed when the device is created (after a change, delete the
   devices and create them again).
4. Save, then press **Test the connection**: it signs in and shows
   yesterday's total of each meter.
5. In the **Discover** tab, create the devices. Their readings are read right
   away.
6. In the energy settings of Gladys, attach your energy contract to the
   consumption of the meter.

## Privacy and security

- The password is kept by Gladys in its database (masked in the interface,
  **not encrypted**), never shown again, and only sent to Fluvius
  (`login.fluvius.be`). The integration refuses any page or redirect that
  leaves Fluvius.
- The access token stays in memory: after a restart, the integration signs in
  again.
- Nothing is sent anywhere else. The logs never hold the e-mail, the
  password, the tokens or the addresses called.

## Limits

- The data comes from the customer portal, not from an official API: a
  change of Mijn Fluvius can break the integration until it is updated (the
  status then says "The Fluvius login changed").
- One electricity meter and one gas meter per integration.
- The injection and the monthly peak are shown, not used by the energy
  monitoring: Gladys has no dated production path for an integration yet.
- Detailed gas readings are hourly: each hour is split into two equal half
  hours.
- Days and quarter hours follow the Brussels time (23- and 25-hour days
  included).

## Troubleshooting

- **"refused the e-mail or the password"**: check them in a browser on
  mijn.fluvius.be and save again. Tried again every 6 hours only, so that the
  account is never locked.
- **"asks for a step only a browser can do"**: sign in once on
  mijn.fluvius.be (code, terms, password change). Tried again every 6 hours.
- **"refused the readings of the … meter"**: check the EAN and the serial
  number, and that the account manages this meter.
- **"No detailed readings…"**: turn the quarter-hour readings on in Mijn
  Fluvius, or choose the daily readings.
- **"asked to slow down"**: nothing to do; every call waits for the time
  Fluvius asked (1 minute to 6 hours).
- **"could not be read… new try in N min"**: a passing problem (network,
  Fluvius down); tried again after 15, 30, 60, then every 120 minutes.

## Credits

The sign-in and the reading of the answers are ported from
[sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
(MIT license). Source code and issues:
[LM1LC3N7/gladys-fluvius](https://github.com/LM1LC3N7/gladys-fluvius).
