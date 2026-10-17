# Fluvius (Vlaanderen) voor Gladys

Niet-officiële integratie, **niet verbonden met Fluvius**. Ze leest uw
digitale meter in Vlaanderen via uw klantenaccount **Mijn Fluvius** en stuurt
het verbruik naar de energiemonitoring van Gladys.

> **Nooit getest met een echt Mijn Fluvius-account.** Ze is gebaseerd op het
> project [sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
> (door de auteur live getest) en op voorbeeldantwoorden. Meld op het
> Gladys-forum wat werkt en wat niet.

## Wat u krijgt

Eén toestel per ingevoerde meter (elektriciteit en/of gas):

- **Consumption (30 min) of (day)**: naar de energiemonitoring van Gladys,
  gedateerd door Fluvius; de kosten van uw energiecontract worden erop
  berekend.
- **Consumption, last published day (kWh)**: het totaal van de laatste
  volledige dag die Fluvius publiceerde.
- **Injection, last published day (kWh)**: alleen elektriciteit; wat u die
  dag op het net zette (zonnepanelen). **Alleen getoond**: nooit als
  verbruik geteld of gefactureerd.
- **Monthly peak, capacity tariff (kW)**: alleen elektriciteit; het hoogste
  kwartiergemiddelde van de laatst gepubliceerde maand, de basis van het
  Vlaamse capaciteitstarief.

Fluvius publiceert de meetwaarden **achteraf**, meestal de dag erna, soms
later, en corrigeert er sommige. De integratie leest Mijn Fluvius **4 keer per
dag**: één keer per dag de laatste dagen opnieuw (standaard 7), de andere
keren de laatste 3 dagen. Een opnieuw gelezen waarde telt nooit dubbel.

## Voordat u begint

- Gladys **5.2.0 of nieuwer**.
- Een **particulier** Mijn Fluvius-account met e-mail en wachtwoord.
  Professionele accounts (itsme / eID) werken niet.
- **Tweestapsverificatie**: de integratie kan geen code invoeren. Vraagt uw
  aanmelding er een (of nieuwe voorwaarden, of een nieuw wachtwoord), dan
  meldt de integratie dat: meld u één keer aan op
  [mijn.fluvius.be](https://mijn.fluvius.be/) in een browser, of zet de
  tweestapsverificatie uit als Fluvius dat toelaat.
- De **EAN** (18 cijfers, begint met 54) en het **serienummer** van elke
  meter, zichtbaar in Mijn Fluvius en op uw facturen.
- Voor gedetailleerde meetwaarden: zet de **kwartierwaarden** (elektriciteit)
  of **uurwaarden** (gas) aan in Mijn Fluvius, of kies dagelijkse waarden.

## Instellen

1. Installeer de integratie vanuit de Gladys-store.
2. Vul e-mail en wachtwoord van Mijn Fluvius in, dan de EAN en het
   serienummer van uw elektriciteits- en/of gasmeter.
3. Kies de meetwaarden: **gedetailleerd** of **dagelijks**, vóór het
   aanmaken van de toestellen (na een wijziging: toestellen verwijderen en
   opnieuw aanmaken).
4. Sla op en klik op **Verbinding testen**.
5. Maak de toestellen aan in het tabblad **Ontdekken**.
6. Koppel uw energiecontract aan het verbruik van de meter in de
   energie-instellingen van Gladys.

## Privacy en beveiliging

Het wachtwoord wordt door Gladys in haar database bewaard (gemaskeerd, **niet
versleuteld**), nooit opnieuw getoond en enkel naar Fluvius gestuurd
(`login.fluvius.be`). Het toegangstoken blijft in het geheugen. De logs
bevatten nooit e-mail, wachtwoord, tokens of adressen.

## Beperkingen

- Gegevens van het klantenportaal, geen officiële API: een wijziging van Mijn
  Fluvius kan de integratie breken tot een update.
- Eén elektriciteitsmeter en één gasmeter per integratie.
- Injectie en maandpiek worden getoond, niet gebruikt door de
  energiemonitoring.
- Gedetailleerde gaswaarden zijn per uur: elk uur wordt in twee gelijke halve
  uren gesplitst.

## Met dank aan

De aanmelding en het lezen van de antwoorden komen uit
[sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
(MIT-licentie). Broncode:
[LM1LC3N7/gladys-fluvius](https://github.com/LM1LC3N7/gladys-fluvius).
