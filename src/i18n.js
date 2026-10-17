// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object.
// -----------------------------------------------------------------------------

const KIND_FR = { electricity: 'électricité', gas: 'gaz' };
const label = (meter) => ({
  en: `${meter.kind} (EAN …${meter.ean.slice(-4)})`,
  fr: `${KIND_FR[meter.kind] ?? meter.kind} (EAN …${meter.ean.slice(-4)})`,
});

/** Join several { en, fr } texts. */
export const join = (texts) => ({
  en: texts.map((t) => t.en).join(' '),
  fr: texts.map((t) => t.fr).join(' '),
});

export const T = {
  noCredentials: {
    en: 'Enter the e-mail and password of your Mijn Fluvius account.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte Mijn Fluvius.',
  },
  noMeter: {
    en: 'Enter the EAN and the serial number of at least one meter (electricity or gas).',
    fr: 'Saisissez l’EAN et le numéro de série d’au moins un compteur (électricité ou gaz).',
  },
  badMeter: (meter) => ({
    en: `The ${label(meter).en} meter needs an 18-digit EAN and its serial number.`,
    fr: `Le compteur ${label(meter).fr} demande un EAN à 18 chiffres et son numéro de série.`,
  }),
  badCredentials: (hours) => ({
    en: `Fluvius refused the e-mail or the password: check them and save. New try in ${hours} h.`,
    fr: `Fluvius a refusé l’e-mail ou le mot de passe : vérifiez-les et enregistrez. Nouvel essai dans ${hours} h.`,
  }),
  interaction: (hours) => ({
    en: `The Fluvius login asks for a step only a browser can do (two-step verification, new terms, password change). Sign in once on mijn.fluvius.be, or turn two-step verification off; this integration cannot enter a code. New try in ${hours} h.`,
    fr: `La connexion Fluvius demande une étape que seul un navigateur peut faire (double authentification, nouvelles conditions, changement de mot de passe). Connectez-vous une fois sur mijn.fluvius.be, ou désactivez la double authentification : cette intégration ne sait pas saisir de code. Nouvel essai dans ${hours} h.`,
  }),
  rateLimited: (minutes) => ({
    en: `Fluvius asked to slow down: every call paused for ${minutes} min.`,
    fr: `Fluvius demande de ralentir : tous les appels sont suspendus ${minutes} min.`,
  }),
  retry: (minutes, message) => ({
    en: `Fluvius could not be read (${message}): new try in ${minutes} min.`,
    fr: `Fluvius n’a pas pu être lu (${message}) : nouvel essai dans ${minutes} min.`,
  }),
  noDevice: {
    en: 'Create the Fluvius devices from the "Discover" tab: their readings are fetched once they exist.',
    fr: 'Créez les appareils Fluvius depuis l’onglet « Découverte » : leurs relevés sont lus dès qu’ils existent.',
  },
  ok: (parts) => ({
    en: `Connected to Mijn Fluvius. Latest day published: ${parts.map((p) => `${label(p.meter).en} ${p.date ?? 'none yet'}`).join(', ')}.`,
    fr: `Connecté à Mijn Fluvius. Dernier jour publié : ${parts.map((p) => `${label(p.meter).fr} ${p.date ?? 'aucun pour l’instant'}`).join(', ')}.`,
  }),
  meterRefused: (meter, message) => ({
    en: `Fluvius refused the readings of the ${label(meter).en} meter (${message}): check its EAN and serial number, and that the account manages it.`,
    fr: `Fluvius a refusé les relevés du compteur ${label(meter).fr} (${message}) : vérifiez son EAN et son numéro de série, et que le compte le gère.`,
  }),
  noDetailed: (meter, days) => ({
    en: `No detailed readings for the ${label(meter).en} meter over the last ${days} days: turn the quarter-hour (or hourly gas) readings on in Mijn Fluvius, or choose daily readings.`,
    fr: `Aucun relevé détaillé pour le compteur ${label(meter).fr} sur les ${days} derniers jours : activez les relevés au quart d’heure (ou horaires pour le gaz) dans Mijn Fluvius, ou choisissez les relevés journaliers.`,
  }),
  test: {
    ok: (parts) => ({
      en: `Sign-in OK. ${parts.map((p) => `${label(p.meter).en}: ${p.kwh === undefined ? 'no reading for yesterday yet' : `${p.kwh} kWh yesterday`}`).join('; ')}.`,
      fr: `Connexion réussie. ${parts.map((p) => `${label(p.meter).fr} : ${p.kwh === undefined ? 'pas encore de relevé pour hier' : `${p.kwh} kWh hier`}`).join(' ; ')}.`,
    }),
    slow: {
      en: 'Fluvius is slow to answer: look at the integration status in a minute.',
      fr: 'Fluvius tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
