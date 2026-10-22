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
  extraireIndices,
  resumer
} from "./logique.js";

const CLE_STOCKAGE = "monsuiviodo.v1";
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
  dialogueConfirmation: document.getElementById("dialogue-confirmation"),
  messageConfirmation: document.getElementById("message-confirmation"),
  boutonScanner: document.getElementById("bouton-scanner"),
  champPhoto: document.getElementById("champ-photo"),
  etatScan: document.getElementById("etat-scan"),
  detailsTexte: document.getElementById("details-texte"),
  texteReconnu: document.getElementById("texte-reconnu")
};

let etat = charger();
let maladieCible = null; // id de la maladie en cours d'édition
let medicamentCible = null; // id du médicament en cours d'édition (null = ajout)
let invitationInstallation = null;
let chargementTesseract = null;
let suppressionArmee = null; // clé du bouton « Supprimer » déjà cliqué une fois
let minuteurSuppression = null;

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
  if (!medicaments.length) return "Aucun médicament : ajoutez-en un pour démarrer le suivi.";
  if (!fin) return `${medicaments.length} médicament${medicaments.length > 1 ? "s" : ""} · en attente de démarrage`;
  const restants = joursRestants(fin, aujourdHui);
  const echeance = restants > 0
    ? `<strong>Traitement jusqu'au ${formaterDate(fin)}</strong> · ${echapper(libelleJours(restants))}`
    : `Traitement terminé le ${formaterDate(fin)}`;
  return echeance;
}

function construireCarte(maladie, aujourdHui) {
  const article = document.createElement("article");
  article.className = "carte";
  article.dataset.maladie = maladie.id;
  const lignes = maladie.medicaments.map((medicament) => construireLigneMedicament(medicament, aujourdHui)).join("");
  article.innerHTML = `
    <header class="carte__entete">
      <div>
        <h2 class="carte__titre">${echapper(maladie.nom)}</h2>
        <p class="carte__sous-titre">${texteSousTitre(maladie, aujourdHui)}</p>
      </div>
      <div class="carte__actions">
        <button type="button" class="bouton bouton--petit" data-action="ajouter-medicament">+ Médicament</button>
        <button type="button" class="bouton bouton--petit" data-action="imprimer-carte">Imprimer</button>
        <button type="button" class="bouton bouton--petit bouton--danger" data-action="supprimer-maladie">Supprimer</button>
      </div>
    </header>
    ${maladie.medicaments.length
      ? `<ul class="medicaments">${lignes}</ul>`
      : `<p class="carte__vide">Ajoutez les médicaments prescrits pour cette maladie.</p>`}
  `;
  return article;
}

function construireLigneMedicament(medicament, aujourdHui) {
  const fin = finMedicament(medicament);
  const statut = etatMedicament(medicament, aujourdHui);
  const restants = joursRestants(fin, aujourdHui);
  const libelles = { attente: "En attente", "en-cours": "En cours", termine: "Terminé" };
  const detail = statut === "en-cours" ? ` · ${libelleJours(restants)}` : "";
  const dates = medicament.debut && fin
    ? `Du ${formaterDate(medicament.debut)} au ${formaterDate(fin)} · ${medicament.dureeJours} jour${medicament.dureeJours > 1 ? "s" : ""}`
    : `Durée prévue : ${medicament.dureeJours} jour${medicament.dureeJours > 1 ? "s" : ""} · pas encore démarré`;
  const boutonDebut = medicament.debut
    ? `<button type="button" class="bouton bouton--petit" data-action="annuler-debut">Annuler le début</button>`
    : `<button type="button" class="bouton bouton--petit bouton--principal" data-action="demarrer">Début</button>`;

  return `
    <li class="medicament" data-medicament="${medicament.id}">
      <div class="medicament__ligne">
        <span class="medicament__nom">${echapper(medicament.nom)}</span>
        <span class="pastille pastille--${statut}">${libelles[statut]}${detail}</span>
      </div>
      ${medicament.posologie ? `<p class="medicament__posologie">${echapper(medicament.posologie)}</p>` : ""}
      <p class="medicament__dates">${echapper(dates)}</p>
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
  if (idMaladie) {
    document.body.classList.add("impression-unique");
    const carte = elements.liste.querySelector(`[data-maladie="${idMaladie}"]`);
    if (carte) carte.classList.add("carte--imprimee");
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
  lien.download = `monsuiviodo-${aujourdHuiISO()}.json`;
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

async function analyserPhoto(fichier) {
  const compteRendu = (message) => { elements.etatScan.textContent = message; };
  try {
    compteRendu("Chargement du moteur de reconnaissance (une seule fois)…");
    const Tesseract = await chargerTesseract();
    compteRendu("Préparation de la reconnaissance…");
    const worker = await Tesseract.createWorker("fra", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          compteRendu(`Reconnaissance en cours… ${Math.round((m.progress || 0) * 100)} %`);
        }
      }
    });
    const { data } = await worker.recognize(fichier);
    await worker.terminate();

    const texte = (data && data.text ? data.text : "").trim();
    elements.texteReconnu.textContent = texte || "(aucun texte détecté)";
    elements.detailsTexte.hidden = false;

    if (!texte) {
      compteRendu("Aucun texte détecté : reprenez la photo avec plus de lumière.");
      return;
    }

    const indices = extraireIndices(texte);
    const formulaire = elements.formulaireMedicament.elements;
    const appliques = [];
    if (indices.nom && !formulaire.nom.value.trim()) { formulaire.nom.value = indices.nom; appliques.push("médicament"); }
    if (indices.posologie && !formulaire.posologie.value.trim()) { formulaire.posologie.value = indices.posologie; appliques.push("posologie"); }
    if (indices.dureeJours && (!formulaire.dureeJours.value || formulaire.dureeJours.value === "7")) {
      formulaire.dureeJours.value = indices.dureeJours;
      appliques.push("durée");
    }

    if (appliques.length) {
      compteRendu(`Texte reconnu. Champs pré-remplis : ${appliques.join(", ")}. Vérifiez avant d'enregistrer.`);
    } else {
      compteRendu("Texte reconnu, mais aucun champ n'a pu être déduit : complétez à la main.");
    }
  } catch (erreur) {
    console.warn("Analyse impossible", erreur);
    compteRendu("Reconnaissance indisponible (le moteur se télécharge au premier usage, une connexion est nécessaire).");
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

elements.boutonScanner.addEventListener("click", () => elements.champPhoto.click());
elements.champPhoto.addEventListener("change", () => {
  const fichier = elements.champPhoto.files && elements.champPhoto.files[0];
  elements.champPhoto.value = "";
  if (fichier) analyserPhoto(fichier);
});

elements.liste.addEventListener("click", (evenement) => {
  const bouton = evenement.target.closest("button[data-action]");
  if (!bouton) return;
  const carte = bouton.closest("[data-maladie]");
  const ligne = bouton.closest("[data-medicament]");
  const idMaladie = carte ? carte.dataset.maladie : null;
  const idMedicament = ligne ? ligne.dataset.medicament : null;

  switch (bouton.dataset.action) {
    case "ajouter-medicament":
      ouvrirDialogueMedicament(idMaladie, null);
      break;

    case "imprimer-carte":
      imprimer(idMaladie);
      break;

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
