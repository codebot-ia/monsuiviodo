/**
 * logique.js — fonctions pures de MonSuiviOrdo (aucun accès au DOM ni au stockage).
 * Toutes les dates « métier » sont des chaînes ISO locales : "AAAA-MM-JJ".
 */

export const MS_PAR_JOUR = 86400000;

/** Date d'aujourd'hui au format ISO local (pas UTC : évite le décalage d'un jour). */
export function aujourdHuiISO() {
  return versISO(new Date());
}

/** Convertit un objet Date en "AAAA-MM-JJ" en heure locale. */
export function versISO(date) {
  const deux = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;
}

/** Convertit "AAAA-MM-JJ" en Date locale calée à midi (immunise contre les changements d'heure). */
export function depuisISO(iso) {
  const [annee, mois, jour] = String(iso).split("-").map(Number);
  return new Date(annee, mois - 1, jour, 12, 0, 0, 0);
}

/** Ajoute (ou retire) des jours à une date ISO. */
export function ajouterJours(iso, jours) {
  const date = depuisISO(iso);
  date.setDate(date.getDate() + Number(jours || 0));
  return versISO(date);
}

/** Date de fin d'un médicament : début + durée - 1 (le jour du début compte comme jour 1). */
export function finMedicament(medicament) {
  if (!medicament || !medicament.debut) return null;
  const duree = Number(medicament.dureeJours);
  if (!Number.isFinite(duree) || duree < 1) return null;
  return ajouterJours(medicament.debut, duree - 1);
}

/** Date de fin d'une maladie : la plus tardive des fins de ses médicaments. */
export function finMaladie(maladie) {
  const medicaments = (maladie && maladie.medicaments) || [];
  const fins = medicaments.map(finMedicament).filter(Boolean).sort();
  return fins.length ? fins[fins.length - 1] : null;
}

/** Nombre de jours restants (jour de fin inclus). 0 ou moins = terminé. */
export function joursRestants(finISO, aujourdHui = aujourdHuiISO()) {
  if (!finISO) return null;
  const ecart = depuisISO(finISO) - depuisISO(aujourdHui);
  return Math.round(ecart / MS_PAR_JOUR) + 1;
}

/** État d'un médicament : "attente" (pas démarré), "en-cours" ou "termine". */
export function etatMedicament(medicament, aujourdHui = aujourdHuiISO()) {
  const fin = finMedicament(medicament);
  if (!fin) return "attente";
  return joursRestants(fin, aujourdHui) > 0 ? "en-cours" : "termine";
}

/** État d'une maladie, déduit de ses médicaments. */
export function etatMaladie(maladie, aujourdHui = aujourdHuiISO()) {
  const medicaments = (maladie && maladie.medicaments) || [];
  if (!medicaments.length) return "vide";
  const etats = medicaments.map((m) => etatMedicament(m, aujourdHui));
  if (etats.includes("en-cours")) return "en-cours";
  if (etats.includes("attente")) return "attente";
  return "termine";
}

/** "2026-10-29" -> "29/10/2026". */
export function formaterDate(iso) {
  if (!iso) return "—";
  const [annee, mois, jour] = String(iso).split("-");
  if (!annee || !mois || !jour) return "—";
  return `${jour}/${mois}/${annee}`;
}

/** Libellé court des jours restants. */
export function libelleJours(nombre) {
  if (nombre === null || nombre === undefined) return "";
  if (nombre <= 0) return "terminé";
  if (nombre === 1) return "dernier jour";
  return `reste ${nombre} j`;
}

/** Identifiant unique, avec repli si crypto.randomUUID est absent. */
export function creerId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Structure de données initiale. */
export function donneesVides() {
  return { version: 1, maladies: [] };
}

function texteSur(valeur, longueurMax) {
  return String(valeur === null || valeur === undefined ? "" : valeur)
    .trim()
    .slice(0, longueurMax);
}

function borneDuree(valeur) {
  const duree = Number(valeur);
  if (!Number.isFinite(duree) || duree < 1) return 7;
  return Math.min(Math.round(duree), 365);
}

/**
 * Nettoie des données lues (stockage local ou sauvegarde importée) :
 * champs attendus uniquement, types corrigés, ids uniques.
 */
export function normaliserDonnees(brut) {
  const donnees = donneesVides();
  const maladies = Array.isArray(brut && brut.maladies) ? brut.maladies : [];
  donnees.maladies = maladies
    .filter((maladie) => maladie && texteSur(maladie.nom, 80))
    .map((maladie) => {
      const medicaments = Array.isArray(maladie.medicaments) ? maladie.medicaments : [];
      return {
        id: texteSur(maladie.id, 64) || creerId(),
        nom: texteSur(maladie.nom, 80),
        creeLe: texteSur(maladie.creeLe, 40) || new Date().toISOString(),
        medicaments: medicaments
          .filter((medicament) => medicament && texteSur(medicament.nom, 80))
          .map((medicament) => {
            const debut = /^\d{4}-\d{2}-\d{2}$/.test(String(medicament.debut))
              ? String(medicament.debut)
              : null;
            return {
              id: texteSur(medicament.id, 64) || creerId(),
              nom: texteSur(medicament.nom, 80),
              posologie: texteSur(medicament.posologie, 120),
              dureeJours: borneDuree(medicament.dureeJours),
              debut
            };
          })
      };
    });
  return donnees;
}

/* ------------------------------------------------------------------ lecture d'ordonnance */

const MOTIF_DOSE = /(\d+\s*(?:comprim|cp\b|g[ée]lul|sachet|dose|goutte|ml\b|ampoul|suppo|bouff[ée]e|application|pulv[ée]))/i;
const MOTIF_RYTHME = /(matin|midi|soir|nuit|coucher|repas|par jour|\/\s*j|toutes les|fois par)/i;
const MOTIF_DOSAGE = /\d+\s*(?:mg|g\b|ui\b|mcg|%|mg\/ml|dose)/i;
const MOTIF_BRUIT = /(ordonnance|pharmacie|pharmacien|docteur|m[ée]decin|\bdr\b|patient|posologie|traitement|dur[ée]e|signature|date|bo[îi]te|notice|conseil|ne pas d[ée]passer|renouvel|g[ée]n[ée]ric|substitu)/i;

/** "7 jours" / "2 semaines" / "1 mois" -> nombre de jours (ou null). */
export function extraireDuree(texte) {
  const contenu = String(texte || "");
  const mois = contenu.match(/(\d{1,2})\s*mois/i);
  const semaines = contenu.match(/(\d{1,2})\s*semaines?/i);
  const jours = contenu.match(/(\d{1,3})\s*(?:jours?|j(?![a-zéèà]))/i);
  let duree = null;
  if (mois) duree = parseInt(mois[1], 10) * 30;
  else if (semaines) duree = parseInt(semaines[1], 10) * 7;
  else if (jours) duree = parseInt(jours[1], 10);
  if (!duree || duree < 1) return null;
  return Math.min(duree, 365);
}

/** Vrai si la ligne ressemble à un nom de médicament (majuscules ou dosage). */
function estNomDeMedicament(ligne) {
  if (ligne.length < 3 || ligne.length > 80) return false;
  if (MOTIF_BRUIT.test(ligne)) return false;
  if (MOTIF_DOSE.test(ligne) && MOTIF_RYTHME.test(ligne)) return false;
  const majuscules = /^[A-ZÉÈÀÂÎÔÛÇ0-9][A-ZÉÈÀÂÎÔÛÇ0-9\s.'’\-/]{2,}$/.test(ligne);
  const avecDosage = MOTIF_DOSAGE.test(ligne) && /^[A-Za-zÉÈÀÂÎÔÛÇ]/.test(ligne);
  return majuscules || avecDosage;
}

/** Nettoie une ligne pour en faire une posologie lisible. */
function nettoyerPosologie(ligne) {
  return ligne
    .replace(/^[\s\-•*·]+/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*pendant\s+\d+\s*(?:jours?|semaines?|mois)\s*$/i, "")
    .trim()
    .slice(0, 120);
}

/**
 * Analyse le texte d'une ordonnance entière et renvoie la maladie (si trouvée)
 * et la liste des médicaments détectés : [{ nom, posologie, dureeJours }].
 * Les valeurs sont des propositions : l'utilisateur les relit et les corrige.
 */
export function extraireOrdonnance(texte) {
  const resultat = { maladie: "", medicaments: [] };
  const contenu = String(texte || "").replace(/\r/g, "");
  if (!contenu.trim()) return resultat;

  // Motif / diagnostic, quand l'ordonnance le mentionne.
  const motif = contenu.match(/(?:pour|motif|diagnostic|indication)\s*:?\s*([A-Za-zÉÈÀÂÎÔÛÇéèêàâîïôûç' \-]{3,60})/i);
  if (motif) {
    const candidat = motif[1].trim().replace(/\s{2,}/g, " ");
    if (candidat && !MOTIF_BRUIT.test(candidat)) resultat.maladie = candidat;
  }

  const lignes = contenu
    .split("\n")
    .map((ligne) => ligne.replace(/\s+/g, " ").trim())
    .filter((ligne) => ligne.length > 1);

  // Découpage en blocs : un bloc démarre sur un nom de médicament.
  const blocs = [];
  let bloc = null;
  for (const ligne of lignes) {
    if (estNomDeMedicament(ligne)) {
      if (bloc) blocs.push(bloc);
      bloc = { nom: ligne, details: [] };
    } else if (bloc) {
      bloc.details.push(ligne);
    }
  }
  if (bloc) blocs.push(bloc);

  for (const element of blocs) {
    const texteBloc = [element.nom, ...element.details].join(" ");
    const posologie = element.details.find((ligne) => MOTIF_DOSE.test(ligne) && MOTIF_RYTHME.test(ligne))
      || element.details.find((ligne) => MOTIF_DOSE.test(ligne))
      || "";
    const duree = extraireDuree(texteBloc);
    resultat.medicaments.push({
      nom: element.nom.replace(/\s{2,}/g, " ").slice(0, 80),
      posologie: posologie ? nettoyerPosologie(posologie) : "",
      dureeJours: duree || 7
    });
  }

  // Repli : aucune ligne « nom » reconnue, mais une posologie existe.
  if (!resultat.medicaments.length) {
    const posologie = lignes.find((ligne) => MOTIF_DOSE.test(ligne) && MOTIF_RYTHME.test(ligne));
    if (posologie) {
      resultat.medicaments.push({
        nom: "",
        posologie: nettoyerPosologie(posologie),
        dureeJours: extraireDuree(contenu) || 7
      });
    }
  }

  // Doublons exacts (même nom et même posologie) supprimés.
  const vus = new Set();
  resultat.medicaments = resultat.medicaments.filter((medicament) => {
    const cle = `${medicament.nom}|${medicament.posologie}`;
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });

  return resultat;
}

/** Résumé textuel de l'état général, pour l'en-tête. */
export function resumer(donnees, aujourdHui = aujourdHuiISO()) {
  const maladies = (donnees && donnees.maladies) || [];
  if (!maladies.length) return "";
  const enCours = maladies.reduce(
    (total, maladie) => total + (maladie.medicaments || []).filter((medicament) => etatMedicament(medicament, aujourdHui) === "en-cours").length,
    0
  );
  const parties = [`${maladies.length} maladie${maladies.length > 1 ? "s" : ""}`];
  if (enCours) parties.push(`${enCours} médicament${enCours > 1 ? "s" : ""} en cours`);
  else parties.push("aucun traitement en cours");
  return parties.join(" · ");
}
