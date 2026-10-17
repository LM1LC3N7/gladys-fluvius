# Fluvius (Flandre) pour Gladys

Intégration non officielle, **sans lien avec Fluvius**. Elle lit votre
compteur numérique en Flandre par votre espace client **Mijn Fluvius** et
envoie sa consommation au suivi énergétique de Gladys.

> **Jamais testée sur un vrai compte Mijn Fluvius.** Elle s'appuie sur le
> projet [sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
> (testé en conditions réelles par son auteur) et sur des réponses d'exemple.
> Dites sur le forum Gladys ce qui marche et ce qui ne marche pas.

## Ce que vous obtenez

Un appareil par compteur saisi (électricité et/ou gaz) :

- **Consumption (30 min)** ou **Consumption (day)** : envoyée au **suivi
  énergétique** de Gladys, datée par Fluvius ; les coûts de votre contrat
  d'énergie sont calculés dessus.
- **Consumption, last published day (kWh)** : le total du dernier jour
  complet publié par Fluvius, pour un tableau de bord.
- **Injection, last published day (kWh)** : électricité seulement ; ce que
  vous avez renvoyé au réseau (panneaux solaires) ce jour-là. **Affichée
  seulement** : jamais comptée comme consommation ni facturée.
- **Monthly peak, capacity tariff (kW)** : électricité seulement ; la plus
  forte puissance moyenne sur un quart d'heure du dernier mois publié, base du
  tarif capacitaire flamand.

Fluvius publie les relevés **après coup**, en général le lendemain, parfois
plus tard, et en corrige certains. L'intégration lit Mijn Fluvius **4 fois par
jour** : une fois par jour elle relit les derniers jours (7 par défaut), les
autres fois les 3 derniers jours. Gladys garde une valeur par demi-heure (ou
par jour) : un relevé relu ou corrigé n'est jamais compté deux fois.

## Avant de commencer

- Gladys **5.2.0 ou plus récent** (consommation datée du suivi énergétique).
- Un compte Mijn Fluvius **particulier** qui se connecte par e-mail et mot de
  passe. Les comptes professionnels (itsme / eID) ne sont pas utilisables.
- **Double authentification** : l'intégration ne sait pas saisir de code. Si
  votre connexion en demande un (ou de nouvelles conditions, ou un changement
  de mot de passe), l'intégration l'indique dans son état : connectez-vous une
  fois sur [mijn.fluvius.be](https://mijn.fluvius.be/) dans un navigateur, ou
  désactivez la double authentification si Fluvius le permet.
- L'**EAN** (18 chiffres, commence par 54) et le **numéro de série** de chaque
  compteur : les deux sont affichés dans Mijn Fluvius et sur vos factures.
- Pour les relevés détaillés : activez les **relevés au quart d'heure**
  (électricité) ou **horaires** (gaz) dans Mijn Fluvius. Sinon, choisissez
  les relevés journaliers.

## Installation

1. Installez l'intégration depuis le store de Gladys.
2. Saisissez l'e-mail et le mot de passe de Mijn Fluvius, puis l'EAN et le
   numéro de série de votre compteur d'électricité et/ou de gaz.
3. Choisissez les relevés : **détaillés** (quarts d'heure, envoyés par
   demi-heure) ou **journaliers**. À choisir avant de créer les appareils : le
   type de la fonctionnalité de consommation est figé à la création (après un
   changement, supprimez les appareils et recréez-les).
4. Enregistrez, puis cliquez sur **Tester la connexion** : elle se connecte et
   affiche le total d'hier de chaque compteur.
5. Dans l'onglet **Découverte**, créez les appareils. Leurs relevés sont lus
   tout de suite.
6. Dans les réglages énergie de Gladys, rattachez votre contrat d'énergie à
   la consommation du compteur.

## Confidentialité et sécurité

- Le mot de passe est gardé par Gladys dans sa base (masqué dans l'interface,
  **non chiffré**), jamais réaffiché, et envoyé seulement à Fluvius
  (`login.fluvius.be`). L'intégration refuse toute page ou redirection qui
  sort de Fluvius.
- Le jeton d'accès reste en mémoire : après un redémarrage, l'intégration se
  reconnecte.
- Rien n'est envoyé ailleurs. Les journaux ne contiennent jamais l'e-mail, le
  mot de passe, les jetons ni les adresses appelées.

## Limites

- Les données viennent de l'espace client, pas d'une API officielle : un
  changement de Mijn Fluvius peut casser l'intégration jusqu'à sa mise à jour
  (l'état indique alors « The Fluvius login changed »).
- Un compteur d'électricité et un compteur de gaz par intégration.
- L'injection et le pic mensuel sont affichés, pas utilisés par le suivi
  énergétique : Gladys n'a pas encore de voie datée pour la production d'une
  intégration.
- Les relevés détaillés du gaz sont horaires : chaque heure est coupée en deux
  demi-heures égales.
- Jours et quarts d'heure suivent l'heure de Bruxelles (journées de 23 et
  25 heures comprises).

## Dépannage

- **« a refusé l'e-mail ou le mot de passe »** : vérifiez-les dans un
  navigateur sur mijn.fluvius.be et enregistrez à nouveau. Réessai toutes les
  6 heures seulement, pour ne jamais bloquer le compte.
- **« demande une étape que seul un navigateur peut faire »** : connectez-vous
  une fois sur mijn.fluvius.be (code, conditions, mot de passe). Réessai
  toutes les 6 heures.
- **« a refusé les relevés du compteur… »** : vérifiez l'EAN et le numéro de
  série, et que le compte gère ce compteur.
- **« Aucun relevé détaillé… »** : activez les relevés au quart d'heure dans
  Mijn Fluvius, ou choisissez les relevés journaliers.
- **« demande de ralentir »** : rien à faire ; tous les appels attendent le
  délai demandé par Fluvius (1 minute à 6 heures).
- **« n'a pas pu être lu… nouvel essai dans N min »** : un problème passager
  (réseau, Fluvius en panne) ; réessai après 15, 30, 60, puis toutes les
  120 minutes.

## Remerciements

La connexion et la lecture des réponses sont reprises de
[sander110419/Fluvius-home-assistant](https://github.com/sander110419/Fluvius-home-assistant)
(licence MIT). Code source et signalements :
[LM1LC3N7/gladys-fluvius](https://github.com/LM1LC3N7/gladys-fluvius).
