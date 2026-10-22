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
            const duree = Number(medicament.dureeJours);
            const debut = /^\d{4}-\d{2}-\d{2}$/.test(String(medicament.debut))
              ? String(medicament.debut)
              : null;
            return {
              id: texteSur(medicament.id, 64) || creerId(),
              nom: texteSur(medicament.nom, 80),
              posologie: texteSur(medicament.posologie, 120),
              dureeJours: Number.isFinite(duree) && duree >= 1 ? Math.min(Math.round(duree), 365) : 7,
              debut
            };
          })
      };
    });
  return donnees;
}

/**
 * Repère dans un texte d'ordonnance (issu de l'OCR) des valeurs probables.
 * Ce sont des suggestions : l'utilisateur les relit et les corrige.
 */
export function extraireIndices(texte) {
  const resultat = { nom: "", posologie: "", dureeJours: null };
  const contenu = String(texte || "").replace(/\r/g, "");
  if (!contenu.trim()) return resultat;

  // Durée : mois, semaines, puis jours.
  const mois = contenu.match(/(\d{1,2})\s*mois/i);
  const semaines = contenu.match(/(\d{1,2})\s*semaines?/i);
  const jours = contenu.match(/(\d{1,3})\s*(?:jours?|j(?![a-zéèà]))/i);
  if (mois) resultat.dureeJours = Math.min(parseInt(mois[1], 10) * 30, 365);
  else if (semaines) resultat.dureeJours = Math.min(parseInt(semaines[1], 10) * 7, 365);
  else if (jours) resultat.dureeJours = Math.min(parseInt(jours[1], 10), 365);
  if (resultat.dureeJours !== null && !(resultat.dureeJours >= 1)) resultat.dureeJours = null;

  const lignes = contenu
    .split("\n")
    .map((ligne) => ligne.replace(/\s+/g, " ").trim())
    .filter((ligne) => ligne.length > 2);

  const motifDose = /(\d+\s*(?:comprim|cp\b|g[ée]lul|sachet|dose|goutte|ml\b|ampoul|suppo|bouff[ée]e|application|pulv[ée]))/i;
  const motifRythme = /(matin|midi|soir|nuit|coucher|repas|par jour|\/\s*j|toutes les)/i;

  const avecDose = lignes.filter((ligne) => motifDose.test(ligne));
  const posologie = avecDose.find((ligne) => motifRythme.test(ligne)) || avecDose[0];
  if (posologie) resultat.posologie = posologie.slice(0, 120);

  const bruits = /(ordonnance|pharmacie|pharmacien|docteur|m[ée]decin|\bdr\b|patient|posologie|traitement|dur[ée]e|signature|date|bo[îi]te|notice|conseil|ne pas d[ée]passer|renouvel)/i;
  const majuscule = lignes.find(
    (ligne) => /^[A-ZÉÈÀÂÎÔÛÇ0-9][A-ZÉÈÀÂÎÔÛÇ0-9\s.'\-]{3,}$/.test(ligne) && !bruits.test(ligne)
  );
  const avecDosageMg = lignes.find(
    (ligne) => /\d+\s*(?:mg|g\b|ui\b|mcg|%|mg\/ml)/i.test(ligne) && !bruits.test(ligne)
  );
  const nom = majuscule || avecDosageMg;
  if (nom) resultat.nom = nom.replace(/\s{2,}/g, " ").slice(0, 80);

  return resultat;
}

/** Résumé textuel de l'état général, pour l'en-tête. */
export function resumer(donnees, aujourdHui = aujourdHuiISO()) {
  const maladies = (donnees && donnees.maladies) || [];
  if (!maladies.length) return "";
  const enCours = maladies.filter((m) => etatMaladie(m, aujourdHui) === "en-cours").length;
  const parties = [`${maladies.length} maladie${maladies.length > 1 ? "s" : ""}`];
  parties.push(enCours ? `${enCours} traitement${enCours > 1 ? "s" : ""} en cours` : "aucun traitement en cours");
  return parties.join(" · ");
}
