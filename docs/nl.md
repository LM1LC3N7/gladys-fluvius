# Fluvius (Vlaanderen) voor Gladys

Niet-officiële integratie, **niet verbonden met Fluvius**. Ze leest uw
digitale meter in Vlaanderen via uw klantenaccount **Mijn Fluvius** en stuurt
het elektriciteitsverbruik naar de energiemonitoring van Gladys.

> **Nooit getest met een echt Mijn Fluvius-account.** Ze is gebaseerd op het
> project [sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
> (door de auteur live getest) en op voorbeeldantwoorden. Meld op het
> Gladys-forum wat werkt en wat niet.

## Wat u krijgt

Eén toestel per ingevoerde meter (elektriciteit en/of gas).

Elektriciteit:

- **Consumption (30 min) of (day)**: naar de energiemonitoring van Gladys,
  gedateerd door Fluvius; de kosten van uw energiecontract worden erop
  berekend.
- **Consumption, last published day (kWh)**: het totaal van de laatste
  volledige dag die Fluvius publiceerde.
- **Injection, last published day (kWh)**: wat u die dag op het net zette
  (zonnepanelen). **Alleen getoond**: nooit als verbruik geteld of
  gefactureerd.
- **Monthly peak, capacity tariff (kW)**: het hoogste kwartiergemiddelde van
  de laatst gepubliceerde maand, de basis van het Vlaamse capaciteitstarief.

Gas: enkel **Consumption, last published day (kWh)**. Gas blijft in deze
versie **buiten de energiemonitoring**: Gladys zou het aan de
hoofdelektriciteitsmeter koppelen en aan het elektriciteitstarief
aanrekenen, want ze kent nog geen gascontracten.

Fluvius publiceert de meetwaarden **achteraf**, meestal de dag erna, soms
later, en corrigeert er sommige. De integratie leest Mijn Fluvius **4 keer per
dag**: één keer per dag de laatste dagen opnieuw (standaard 7), de andere
keren de laatste 3 dagen. Een opnieuw gelezen waarde telt nooit dubbel.

## Voordat u begint

- Gladys **5.2.0 of nieuwer**, met als tijdzone **Europe/Brussels,
  Europe/Paris of Europe/Amsterdam** (dezelfde klok als België).
- Een **particulier** Mijn Fluvius-account met e-mail en wachtwoord.
  Professionele accounts (itsme / eID) werken niet.
- **Tweestapsverificatie**: de integratie kan geen code invoeren. Vraagt uw
  aanmelding er een (of nieuwe voorwaarden, of een nieuw wachtwoord), dan
  meldt de integratie dat: meld u één keer aan op
  [mijn.fluvius.be](https://mijn.fluvius.be/) in een browser, of zet de
  tweestapsverificatie uit als Fluvius dat toelaat.
- De **EAN** (18 cijfers, begint met 54) en het **serienummer** van elke
  meter (beide verplicht), zichtbaar in Mijn Fluvius en op uw facturen.
- Voor gedetailleerde elektriciteitswaarden: zet de **kwartierwaarden** aan
  in Mijn Fluvius, of kies dagelijkse waarden.

## Instellen

1. Installeer de integratie vanuit de Gladys-store.
2. Vul e-mail en wachtwoord van Mijn Fluvius in, dan de EAN en het
   serienummer van uw elektriciteits- en/of gasmeter.
3. Kies de elektriciteitswaarden: **gedetailleerd** of **dagelijks**, vóór
   het aanmaken van het toestel (na een wijziging: toestel verwijderen en
   opnieuw aanmaken). Gas wordt altijd per dag gelezen.
4. Sla op en klik op **Verbinding testen**.
5. Maak de toestellen aan in het tabblad **Ontdekken**.
6. Koppel uw energiecontract aan het elektriciteitsverbruik in de
   energie-instellingen van Gladys.

## Privacy en beveiliging

Het wachtwoord wordt door Gladys in haar database bewaard (gemaskeerd, **niet
versleuteld**), nooit opnieuw getoond en enkel naar Fluvius gestuurd
(`login.fluvius.be`), in https, alleen naar de aanmeldserver die Mijn Fluvius
opgeeft of naar een `fluvius.be`-adres. Het toegangstoken blijft in het
geheugen. De logs bevatten nooit e-mail, wachtwoord, tokens of adressen.

## Beperkingen

- Gegevens van het klantenportaal, geen officiële API: een wijziging van Mijn
  Fluvius kan de integratie breken tot een update (nieuwe poging elke 6 uur).
- Eén elektriciteitsmeter en één gasmeter per integratie; gas niet in de
  energiemonitoring.
- Injectie en maandpiek worden getoond, niet gebruikt door de
  energiemonitoring.
- Een half uur waarvan een kwartier ontbreekt, wordt nooit gepubliceerd.
- Staat de integratie langer stil dan het aantal "dagen opnieuw gelezen",
  dan worden de oudere dagen nooit aangevuld: verhoog de instelling (tot 31)
  gedurende een dag.
- Een piek die Gladys uit het halfuurverbruik berekent, is niet de piek van
  het capaciteitstarief (gemeten per 15 minuten): gebruik de sensor
  "Monthly peak".

## Met dank aan

De aanmelding en het lezen van de antwoorden komen uit
[sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
(MIT-licentie). Broncode:
[LM1LC3N7/gladys-fluvius](https://github.com/LM1LC3N7/gladys-fluvius).
