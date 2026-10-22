/**
 * app.js — MonSuiviOrdo
 * Interface, stockage local (localStorage) et reconnaissance de texte locale (Tesseract.js).
 * Aucune donnée n'est envoyée à un serveur : tout reste dans le navigateur.
 */
import {
  aujourdHuiISO,
  finMedicament,
  finMaladie,
  joursRestants,
  etatMedicament,
  etatMaladie,
  formaterDate,
  libelleJours,
  creerId,
  donneesVides,
  normaliserDonnees,
  extraireOrdonnance,
  resumer
} from "./logique.js";

const CLE_STOCKAGE = "monsuiviordo.v1";
const URL_TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

const elements = {
  liste: document.getElementById("liste"),
  vide: document.getElementById("vide"),
  resume: document.getElementById("resume"),
  notifications: document.getElementById("notifications"),
  boutonImprimerTout: document.getElementById("bouton-imprimer-tout"),
  boutonNouvelleMaladie: document.getElementById("bouton-nouvelle-maladie"),
  boutonExporter: document.getElementById("bouton-exporter"),
  boutonImporter: document.getElementById("bouton-importer"),
  champImport: document.getElementById("champ-import"),
  boutonInstaller: document.getElementById("bouton-installer"),
  dialogueMaladie: document.getElementById("dialogue-maladie"),
  formulaireMaladie: document.getElementById("formulaire-maladie"),
  dialogueMedicament: document.getElementById("dialogue-medicament"),
  formulaireMedicament: document.getElementById("formulaire-medicament"),
  titreDialogueMedicament: document.getElementById("titre-dialogue-medicament"),
  impressionDate: document.getElementById("impression-date"),
  dialogueConfirmation: document.getElementById("dialogue-confirmation"),
  messageConfirmation: document.getElementById("message-confirmation"),
  champPhotoMaladie: document.getElementById("champ-photo-maladie"),
  dialogueAnalyse: document.getElementById("dialogue-analyse"),
  formulaireAnalyse: document.getElementById("formulaire-analyse"),
  listeAnalyse: document.getElementById("liste-analyse"),
  etatAnalyse: document.getElementById("etat-analyse"),
  detailsAnalyse: document.getElementById("details-analyse"),
  texteAnalyse: document.getElementById("texte-analyse"),
  boutonAjouterAnalyse: document.getElementById("bouton-ajouter-analyse")
};

let etat = charger();
let maladieCible = null; // id de la maladie en cours d'édition
let medicamentCible = null; // id du médicament en cours d'édition (null = ajout)
let invitationInstallation = null;
let chargementTesseract = null;
let suppressionArmee = null; // clé du bouton « Supprimer » déjà cliqué une fois
let minuteurSuppression = null;
const cartesOuvertes = new Set(); // maladies dépliées (repliées par défaut)

/* ------------------------------------------------------------------ utilitaires */

function echapper(texte) {
  const remplacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(texte === null || texte === undefined ? "" : texte).replace(/[&<>"']/g, (c) => remplacements[c]);
}

function notifier(message) {
  const bulle = document.createElement("p");
  bulle.className = "notification";
  bulle.textContent = message;
  elements.notifications.appendChild(bulle);
  while (elements.notifications.children.length > 2) {
    elements.notifications.firstElementChild.remove();
  }
  window.setTimeout(() => bulle.remove(), 3400);
}

/**
 * Suppression en deux temps : le premier clic arme le bouton (« Certain ? »),
 * le second supprime. Sans second clic sous 4 s, le bouton reprend son libellé.
 */
function armerSuppression(bouton, cle) {
  desarmerSuppression();
  bouton.dataset.libelleInitiale = bouton.textContent.trim();
  bouton.textContent = "Certain ?";
  bouton.classList.add("bouton--arme");
  suppressionArmee = cle;
  minuteurSuppression = window.setTimeout(() => {
    bouton.textContent = bouton.dataset.libelleInitiale || "Supprimer";
    bouton.classList.remove("bouton--arme");
    suppressionArmee = null;
    minuteurSuppression = null;
  }, 4000);
}

function desarmerSuppression() {
  if (minuteurSuppression) {
    window.clearTimeout(minuteurSuppression);
    minuteurSuppression = null;
  }
  document.querySelectorAll(".bouton--arme").forEach((bouton) => {
    bouton.textContent = bouton.dataset.libelleInitiale || "Supprimer";
    bouton.classList.remove("bouton--arme");
  });
  suppressionArmee = null;
}

/** Boîte de confirmation intégrée à l'application (remplace window.confirm). */
function demanderConfirmation(message) {
  return new Promise((resoudre) => {
    elements.messageConfirmation.textContent = message;
    const surFermeture = () => {
      elements.dialogueConfirmation.removeEventListener("close", surFermeture);
      resoudre(elements.dialogueConfirmation.returnValue === "confirmer");
    };
    elements.dialogueConfirmation.addEventListener("close", surFermeture);
    elements.dialogueConfirmation.returnValue = "annuler";
    elements.dialogueConfirmation.showModal();
  });
}

/* ------------------------------------------------------------------ stockage */

function charger() {
  try {
    const brut = window.localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return donneesVides();
    return normaliserDonnees(JSON.parse(brut));
  } catch (erreur) {
    console.warn("Lecture du stockage impossible", erreur);
    return donneesVides();
  }
}

function sauvegarder() {
  try {
    window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat));
  } catch (erreur) {
    console.warn("Écriture du stockage impossible", erreur);
    notifier("Enregistrement impossible : stockage plein ou désactivé.");
  }
}

function trouverMaladie(id) {
  return etat.maladies.find((maladie) => maladie.id === id) || null;
}

/* ------------------------------------------------------------------ rendu */

function rendre() {
  const aujourdHui = aujourdHuiISO();
  suppressionArmee = null;
  if (minuteurSuppression) {
    window.clearTimeout(minuteurSuppression);
    minuteurSuppression = null;
  }
  elements.liste.replaceChildren();
  for (const maladie of etat.maladies) {
    elements.liste.appendChild(construireCarte(maladie, aujourdHui));
  }
  elements.vide.hidden = etat.maladies.length > 0;
  elements.resume.textContent = resumer(etat, aujourdHui);
}

function texteSousTitre(maladie, aujourdHui) {
  const fin = finMaladie(maladie);
  const medicaments = maladie.medicaments;
  if (!medicaments.length) {
    return `Aucun médicament<span class="ecran-seul"> : ajoutez-en un pour démarrer le suivi</span>`;
  }
  if (!fin) {
    const nombre = medicaments.length;
    return `${nombre} médicament${nombre > 1 ? "s" : ""}<span class="ecran-seul"> · en attente de démarrage</span>`;
  }
  const restants = joursRestants(fin, aujourdHui);
  const detail = restants > 0 ? libelleJours(restants) : "terminé";
  return `<strong>Traitement jusqu'au ${formaterDate(fin)}</strong><span class="ecran-seul"> · ${echapper(detail)}</span>`;
}

function construireCarte(maladie, aujourdHui) {
  const article = document.createElement("article");
  const ouverte = cartesOuvertes.has(maladie.id);
  const nombre = maladie.medicaments.length;
  article.className = `carte ${ouverte ? "carte--ouverte" : "carte--repliee"}`;
  article.dataset.maladie = maladie.id;
  const lignes = maladie.medicaments.map((medicament) => construireLigneMedicament(medicament, aujourdHui)).join("");
  article.innerHTML = `
    <header class="carte__entete">
      <h2 class="carte__titre-ligne">
        <button type="button" class="carte__bascule" data-action="basculer-maladie"
                aria-expanded="${ouverte}" aria-controls="corps-${maladie.id}">
          <span class="carte__entete-texte">
            <span class="carte__titre">${echapper(maladie.nom)}</span>
            <span class="carte__sous-titre">${texteSousTitre(maladie, aujourdHui)}</span>
          </span>
          ${nombre ? `<span class="carte__compte" aria-hidden="true">${nombre}</span>` : ""}
          <span class="carte__chevron" aria-hidden="true"></span>
        </button>
      </h2>
    </header>
    <div class="carte__corps" id="corps-${maladie.id}">
      <div class="carte__actions">
        <button type="button" class="bouton bouton--petit" data-action="ajouter-medicament">+ Médicament</button>
        <button type="button" class="bouton bouton--petit" data-action="scanner-ordonnance">Scanner</button>
        <button type="button" class="bouton bouton--petit" data-action="imprimer-carte">Imprimer</button>
        <button type="button" class="bouton bouton--petit bouton--danger" data-action="supprimer-maladie">Supprimer</button>
      </div>
      ${nombre
        ? `<ul class="medicaments">${lignes}</ul>`
        : `<p class="carte__vide">Ajoutez les médicaments prescrits pour cette maladie.</p>`}
    </div>
  `;
  return article;
}

function construireLigneMedicament(medicament, aujourdHui) {
  const fin = finMedicament(medicament);
  const statut = etatMedicament(medicament, aujourdHui);
  const restants = joursRestants(fin, aujourdHui);
  const libelles = { attente: "En attente", "en-cours": "En cours", termine: "Terminé" };
  const detail = statut === "en-cours" ? ` · ${libelleJours(restants)}` : "";
  const duree = `${medicament.dureeJours} jour${medicament.dureeJours > 1 ? "s" : ""}`;
  const dates = medicament.debut && fin
    ? `Du ${formaterDate(medicament.debut)} au ${formaterDate(fin)} · ${duree}`
    : `<span class="ecran-seul">Durée prévue : </span>${duree}<span class="ecran-seul"> · pas encore démarré</span>`;
  const boutonDebut = medicament.debut
    ? `<button type="button" class="bouton bouton--petit" data-action="annuler-debut">Annuler</button>`
    : `<button type="button" class="bouton bouton--petit bouton--principal" data-action="demarrer">Début</button>`;

  return `
    <li class="medicament" data-medicament="${medicament.id}">
      <div class="medicament__ligne">
        <span class="medicament__nom">${echapper(medicament.nom)}</span>
        <span class="pastille pastille--${statut}">${libelles[statut]}${detail}</span>
      </div>
      ${medicament.posologie ? `<p class="medicament__posologie">${echapper(medicament.posologie)}</p>` : ""}
      <p class="medicament__dates">${dates}</p>
      <div class="medicament__actions">
        ${boutonDebut}
        <button type="button" class="bouton bouton--petit" data-action="modifier-medicament">Modifier</button>
        <button type="button" class="bouton bouton--petit bouton--danger" data-action="supprimer-medicament">Supprimer</button>
      </div>
    </li>
  `;
}

/* ------------------------------------------------------------------ dialogues */

function ouvrirDialogueMaladie() {
  elements.formulaireMaladie.reset();
  elements.dialogueMaladie.showModal();
  elements.formulaireMaladie.elements.nom.focus();
}

function ouvrirDialogueMedicament(idMaladie, idMedicament) {
  const maladie = trouverMaladie(idMaladie);
  if (!maladie) return;
  maladieCible = idMaladie;
  medicamentCible = idMedicament || null;
  elements.formulaireMedicament.reset();
  elements.etatScan.textContent = "";
  elements.detailsTexte.hidden = true;
  elements.detailsTexte.open = false;
  elements.texteReconnu.textContent = "";

  if (medicamentCible) {
    const medicament = maladie.medicaments.find((m) => m.id === medicamentCible);
    if (!medicament) return;
    elements.titreDialogueMedicament.textContent = "Modifier le médicament";
    elements.formulaireMedicament.elements.nom.value = medicament.nom;
    elements.formulaireMedicament.elements.posologie.value = medicament.posologie || "";
    elements.formulaireMedicament.elements.dureeJours.value = medicament.dureeJours;
    elements.formulaireMedicament.elements.debut.value = medicament.debut || "";
  } else {
    elements.titreDialogueMedicament.textContent = "Nouveau médicament";
    elements.formulaireMedicament.elements.dureeJours.value = 7;
  }

  elements.dialogueMedicament.showModal();
  elements.formulaireMedicament.elements.nom.focus();
}

/* ------------------------------------------------------------------ impression */

function reinitialiserImpression() {
  document.body.classList.remove("impression-unique");
  document.querySelectorAll(".carte--imprimee").forEach((carte) => carte.classList.remove("carte--imprimee"));
}

function imprimer(idMaladie) {
  reinitialiserImpression();
  let complement = "";
  if (idMaladie) {
    document.body.classList.add("impression-unique");
    const carte = elements.liste.querySelector(`[data-maladie="${idMaladie}"]`);
    if (carte) carte.classList.add("carte--imprimee");
    const maladie = trouverMaladie(idMaladie);
    if (maladie) complement = ` · ${maladie.nom}`;
  }
  if (elements.impressionDate) {
    elements.impressionDate.textContent = `${complement} — document édité le ${formaterDate(aujourdHuiISO())}`;
  }
  window.addEventListener("afterprint", reinitialiserImpression, { once: true });
  window.setTimeout(() => window.print(), 60);
  window.setTimeout(reinitialiserImpression, 1500);
}

/* ------------------------------------------------------------------ sauvegardes */

function exporter() {
  const charge = {
    application: "MonSuiviOrdo",
    version: 1,
    exporteLe: new Date().toISOString(),
    donnees: etat
  };
  const blob = new Blob([JSON.stringify(charge, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = `monsuiviordo-${aujourdHuiISO()}.json`;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  notifier("Sauvegarde téléchargée.");
}

async function importer(fichier) {
  try {
    const charge = JSON.parse(await fichier.text());
    const donnees = normaliserDonnees(charge && charge.donnees ? charge.donnees : charge);
    if (!donnees.maladies.length) {
      notifier("Cette sauvegarde ne contient aucune maladie.");
      return;
    }
    const accord = await demanderConfirmation(
      `Remplacer les ${etat.maladies.length} maladie(s) actuelles par les ${donnees.maladies.length} de la sauvegarde ?`
    );
    if (!accord) return;
    etat = donnees;
    sauvegarder();
    rendre();
    notifier("Sauvegarde restaurée.");
  } catch (erreur) {
    console.warn("Import impossible", erreur);
    notifier("Fichier illisible : sauvegarde au format JSON attendue.");
  }
}

/* ------------------------------------------------------------------ scan d'ordonnance */

function chargerTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!chargementTesseract) {
    chargementTesseract = new Promise((resoudre, rejeter) => {
      const script = document.createElement("script");
      script.src = URL_TESSERACT;
      script.crossOrigin = "anonymous";
      script.onload = () => (window.Tesseract ? resoudre(window.Tesseract) : rejeter(new Error("moteur absent")));
      script.onerror = () => rejeter(new Error("chargement réseau impossible"));
      document.head.appendChild(script);
    });
  }
  return chargementTesseract;
}

/**
 * Prépare la photo avant OCR : agrandissement, niveaux de gris, contraste.
 * Une ordonnance photographiée donne de bien meilleurs résultats ainsi.
 */
async function preparerImage(fichier) {
  try {
    const bitmap = await createImageBitmap(fichier);
    const largeurCible = Math.min(2200, Math.max(1400, bitmap.width));
    const echelle = largeurCible / bitmap.width;
    const canevas = document.createElement("canvas");
    canevas.width = Math.round(bitmap.width * echelle);
    canevas.height = Math.round(bitmap.height * echelle);
    const contexte = canevas.getContext("2d", { willReadFrequently: true });
    contexte.drawImage(bitmap, 0, 0, canevas.width, canevas.height);
    const image = contexte.getImageData(0, 0, canevas.width, canevas.height);
    const donnees = image.data;
    for (let i = 0; i < donnees.length; i += 4) {
      const gris = 0.299 * donnees[i] + 0.587 * donnees[i + 1] + 0.114 * donnees[i + 2];
      const contraste = Math.max(0, Math.min(255, (gris - 140) * 1.45 + 140));
      donnees[i] = donnees[i + 1] = donnees[i + 2] = contraste;
    }
    contexte.putImageData(image, 0, 0);
    return canevas;
  } catch (erreur) {
    console.warn("Préparation de l'image impossible, photo brute utilisée", erreur);
    return fichier;
  }
}

/** Lance l'OCR locale sur une photo et renvoie le texte reconnu. */
async function lireTexte(fichier) {
  elements.etatAnalyse.textContent = "Préparation de l'image…";
  const source = await preparerImage(fichier);
  elements.etatAnalyse.textContent = "Chargement du moteur de reconnaissance (une seule fois)…";
  const Tesseract = await chargerTesseract();
  elements.etatAnalyse.textContent = "Reconnaissance en cours…";
  const worker = await Tesseract.createWorker("fra", 1, {
    logger: (m) => {
      if (m.status === "recognizing text") {
        elements.etatAnalyse.textContent = `Reconnaissance en cours… ${Math.round((m.progress || 0) * 100)} %`;
      }
    }
  });
  // Colonne unique de texte et espaces conservés : indispensable pour séparer
  // les noms de médicaments de leur posologie.
  await worker.setParameters({
    tessedit_pageseg_mode: "4",
    preserve_interword_spaces: "1"
  });
  const { data } = await worker.recognize(source);
  await worker.terminate();
  return (data && data.text ? data.text : "").trim();
}

/** Ouvre l'aperçu d'analyse, puis remplit les médicaments détectés pour relecture. */
async function scannerPourMaladie(idMaladie, fichier) {
  const maladie = trouverMaladie(idMaladie);
  if (!maladie) return;
  maladieCible = idMaladie;
  ouvrirAnalyse("Analyse de la photo en cours…");
  try {
    const texte = await lireTexte(fichier);
    if (!texte) {
      elements.etatAnalyse.textContent = "Aucun texte détecté : reprenez la photo avec plus de lumière, ou saisissez à la main.";
      ajouterLigneAnalyse({ nom: "", posologie: "", dureeJours: 7 });
      return;
    }
    remplirAnalyse(extraireOrdonnance(texte), texte);
  } catch (erreur) {
    console.warn("Analyse impossible", erreur);
    elements.etatAnalyse.textContent = "Reconnaissance indisponible (le moteur se télécharge au premier usage : une connexion est nécessaire).";
  }
}

function ouvrirAnalyse(messageAttente) {
  elements.listeAnalyse.replaceChildren();
  elements.detailsAnalyse.hidden = true;
  elements.detailsAnalyse.open = false;
  elements.texteAnalyse.textContent = "";
  elements.etatAnalyse.textContent = messageAttente || "";
  majBoutonAnalyse();
  if (!elements.dialogueAnalyse.open) elements.dialogueAnalyse.showModal();
}

/** Ajoute une ligne éditable (un médicament détecté) dans l'aperçu. */
function ajouterLigneAnalyse(valeurs) {
  const ligne = document.createElement("div");
  ligne.className = "ligne-analyse";
  ligne.innerHTML = `
    <label class="ligne-analyse__choix">
      <input type="checkbox" checked aria-label="Ajouter ce médicament">
    </label>
    <div class="ligne-analyse__champs">
      <input class="champ__saisie" data-champ="nom" type="text" maxlength="80"
             placeholder="Médicament" aria-label="Médicament" value="${echapper(valeurs.nom || "")}">
      <textarea class="champ__saisie champ__saisie--zone" data-champ="posologie" rows="2" maxlength="220"
                placeholder="Posologie" aria-label="Posologie">${echapper(valeurs.posologie || "")}</textarea>
      <div class="ligne-analyse__pied">
        <label class="ligne-analyse__duree">
          <span>Durée (jours)</span>
          <input class="champ__saisie" data-champ="dureeJours" type="number" min="1" max="365"
                 value="${Number(valeurs.dureeJours) > 0 ? Number(valeurs.dureeJours) : 7}" aria-label="Durée en jours">
        </label>
        <button type="button" class="bouton bouton--petit bouton--danger" data-retirer>Retirer</button>
      </div>
    </div>`;
  elements.listeAnalyse.appendChild(ligne);
  majBoutonAnalyse();
  return ligne;
}

function majBoutonAnalyse() {
  const total = elements.listeAnalyse.querySelectorAll('.ligne-analyse input[type="checkbox"]:checked').length;
  elements.boutonAjouterAnalyse.disabled = total === 0;
  elements.boutonAjouterAnalyse.textContent = total > 1 ? `Ajouter ${total} médicaments` : "Ajouter le médicament";
}

function remplirAnalyse(ordonnance, texte) {
  const medicaments = (ordonnance && ordonnance.medicaments) || [];
  if (!medicaments.length) {
    elements.etatAnalyse.textContent = "Aucun médicament reconnu : complétez la ligne ci-dessous à la main.";
    ajouterLigneAnalyse({ nom: "", posologie: "", dureeJours: 7 });
  } else {
    const nombre = medicaments.length;
    elements.etatAnalyse.textContent = `${nombre} médicament${nombre > 1 ? "s" : ""} détecté${nombre > 1 ? "s" : ""} — relisez avant d'ajouter.`;
    medicaments.forEach((medicament) => ajouterLigneAnalyse(medicament));
  }
  if (texte) {
    elements.texteAnalyse.textContent = texte;
    elements.detailsAnalyse.hidden = false;
  }
  if (elements.dialogueAnalyse.open) {
    elements.dialogueAnalyse.scrollTop = 0;
  }
}

/* ------------------------------------------------------------------ événements */

elements.boutonNouvelleMaladie.addEventListener("click", ouvrirDialogueMaladie);
elements.boutonImprimerTout.addEventListener("click", () => imprimer(null));
elements.boutonExporter.addEventListener("click", exporter);
elements.boutonImporter.addEventListener("click", () => elements.champImport.click());
elements.champImport.addEventListener("change", () => {
  const fichier = elements.champImport.files && elements.champImport.files[0];
  elements.champImport.value = "";
  if (fichier) importer(fichier);
});

document.addEventListener("click", (evenement) => {
  const action = evenement.target.closest("[data-action]");
  if (action && action.dataset.action === "nouvelle-maladie") ouvrirDialogueMaladie();
  const fermeture = evenement.target.closest("[data-fermer]");
  if (fermeture) {
    const dialogue = fermeture.closest("dialog");
    if (dialogue) dialogue.close();
  }
});

elements.formulaireMaladie.addEventListener("submit", (evenement) => {
  evenement.preventDefault();
  const nom = elements.formulaireMaladie.elements.nom.value.trim();
  if (!nom) return;
  etat.maladies.unshift({ id: creerId(), nom, creeLe: new Date().toISOString(), medicaments: [] });
  sauvegarder();
  rendre();
  elements.dialogueMaladie.close();
  notifier(`« ${nom} » ajoutée.`);
});

elements.formulaireMedicament.addEventListener("submit", (evenement) => {
  evenement.preventDefault();
  const maladie = trouverMaladie(maladieCible);
  if (!maladie) return;
  cartesOuvertes.add(maladie.id);
  const formulaire = elements.formulaireMedicament.elements;
  const nom = formulaire.nom.value.trim();
  if (!nom) return;
  const duree = Math.min(Math.max(parseInt(formulaire.dureeJours.value, 10) || 1, 1), 365);
  const valeurs = {
    nom,
    posologie: formulaire.posologie.value.trim(),
    dureeJours: duree,
    debut: formulaire.debut.value || null
  };

  if (medicamentCible) {
    const medicament = maladie.medicaments.find((m) => m.id === medicamentCible);
    if (medicament) Object.assign(medicament, valeurs);
    notifier("Médicament modifié.");
  } else {
    maladie.medicaments.push({ id: creerId(), ...valeurs });
    notifier("Médicament ajouté.");
  }

  sauvegarder();
  rendre();
  elements.dialogueMedicament.close();
});

elements.champPhotoMaladie.addEventListener("change", () => {
  const fichier = elements.champPhotoMaladie.files && elements.champPhotoMaladie.files[0];
  elements.champPhotoMaladie.value = "";
  if (fichier && maladieCible) scannerPourMaladie(maladieCible, fichier);
});

elements.listeAnalyse.addEventListener("click", (evenement) => {
  const retirer = evenement.target.closest("[data-retirer]");
  if (!retirer) return;
  const ligne = retirer.closest(".ligne-analyse");
  if (ligne) ligne.remove();
  majBoutonAnalyse();
});

elements.listeAnalyse.addEventListener("change", (evenement) => {
  if (evenement.target.matches('input[type="checkbox"]')) majBoutonAnalyse();
});

elements.formulaireAnalyse.addEventListener("submit", (evenement) => {
  evenement.preventDefault();
  const maladie = trouverMaladie(maladieCible);
  if (!maladie) return;
  cartesOuvertes.add(maladie.id);
  const ajouts = [];
  for (const ligne of elements.listeAnalyse.querySelectorAll(".ligne-analyse")) {
    const coche = ligne.querySelector('input[type="checkbox"]').checked;
    const nom = ligne.querySelector('[data-champ="nom"]').value.trim();
    if (!coche || !nom) continue;
    const duree = parseInt(ligne.querySelector('[data-champ="dureeJours"]').value, 10);
    ajouts.push({
      id: creerId(),
      nom,
      posologie: ligne.querySelector('[data-champ="posologie"]').value.trim(),
      dureeJours: Math.min(Math.max(duree || 7, 1), 365),
      debut: null
    });
  }
  if (!ajouts.length) {
    notifier("Aucun médicament retenu : cochez une ligne et renseignez son nom.");
    return;
  }
  maladie.medicaments.push(...ajouts);
  sauvegarder();
  rendre();
  elements.dialogueAnalyse.close();
  notifier(`${ajouts.length} médicament${ajouts.length > 1 ? "s" : ""} ajouté${ajouts.length > 1 ? "s" : ""}.`);
});

elements.liste.addEventListener("click", (evenement) => {
  const bouton = evenement.target.closest("button[data-action]");
  if (!bouton) return;
  const carte = bouton.closest("[data-maladie]");
  const ligne = bouton.closest("[data-medicament]");
  const idMaladie = carte ? carte.dataset.maladie : null;
  const idMedicament = ligne ? ligne.dataset.medicament : null;

  switch (bouton.dataset.action) {
    case "basculer-maladie": {
      const article = bouton.closest(".carte");
      const id = article ? article.dataset.maladie : null;
      if (!id) break;
      if (cartesOuvertes.has(id)) cartesOuvertes.delete(id);
      else cartesOuvertes.add(id);
      const desormaisOuverte = cartesOuvertes.has(id);
      article.classList.toggle("carte--ouverte", desormaisOuverte);
      article.classList.toggle("carte--repliee", !desormaisOuverte);
      bouton.setAttribute("aria-expanded", String(desormaisOuverte));
      break;
    }

    case "ajouter-medicament":
      if (idMaladie) cartesOuvertes.add(idMaladie);
      ouvrirDialogueMedicament(idMaladie, null);
      break;

    case "imprimer-carte":
      imprimer(idMaladie);
      break;

    case "scanner-ordonnance": {
      const maladie = trouverMaladie(idMaladie);
      if (!maladie) break;
      maladieCible = idMaladie;
      cartesOuvertes.add(idMaladie);
      elements.champPhotoMaladie.click();
      break;
    }

    case "supprimer-maladie": {
      const maladie = trouverMaladie(idMaladie);
      if (!maladie) break;
      if (suppressionArmee !== `maladie:${idMaladie}`) {
        armerSuppression(bouton, `maladie:${idMaladie}`);
        break;
      }
      etat.maladies = etat.maladies.filter((m) => m.id !== idMaladie);
      sauvegarder();
      rendre();
      notifier("Maladie supprimée.");
      break;
    }

    case "demarrer": {
      const maladie = trouverMaladie(idMaladie);
      const medicament = maladie && maladie.medicaments.find((m) => m.id === idMedicament);
      if (!medicament) break;
      medicament.debut = aujourdHuiISO();
      sauvegarder();
      rendre();
      notifier(`Traitement démarré : fin le ${formaterDate(finMedicament(medicament))}.`);
      break;
    }

    case "annuler-debut": {
      const maladie = trouverMaladie(idMaladie);
      const medicament = maladie && maladie.medicaments.find((m) => m.id === idMedicament);
      if (!medicament) break;
      medicament.debut = null;
      sauvegarder();
      rendre();
      notifier("Début annulé : le médicament repasse en attente.");
      break;
    }

    case "modifier-medicament":
      ouvrirDialogueMedicament(idMaladie, idMedicament);
      break;

    case "supprimer-medicament": {
      const maladie = trouverMaladie(idMaladie);
      if (!maladie) break;
      const medicament = maladie.medicaments.find((m) => m.id === idMedicament);
      if (!medicament) break;
      if (suppressionArmee !== `medicament:${idMedicament}`) {
        armerSuppression(bouton, `medicament:${idMedicament}`);
        break;
      }
      maladie.medicaments = maladie.medicaments.filter((m) => m.id !== idMedicament);
      sauvegarder();
      rendre();
      notifier("Médicament supprimé.");
      break;
    }

    default:
      break;
  }
});

// Recalcule les compteurs au retour sur l'onglet (changement de jour).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") rendre();
});

// Installation en application (Android/Chrome) quand le navigateur le propose.
window.addEventListener("beforeinstallprompt", (evenement) => {
  evenement.preventDefault();
  invitationInstallation = evenement;
  elements.boutonInstaller.hidden = false;
});

elements.boutonInstaller.addEventListener("click", async () => {
  if (!invitationInstallation) return;
  invitationInstallation.prompt();
  await invitationInstallation.userChoice;
  invitationInstallation = null;
  elements.boutonInstaller.hidden = true;
});

// Service worker : fonctionne hors ligne après la première visite.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((erreur) => {
      console.warn("Service worker non enregistré", erreur);
    });
  });
}

rendre();
