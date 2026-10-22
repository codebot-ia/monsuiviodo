/* MonSuiviOrdo — service worker : application disponible hors ligne. */
const VERSION = "monsuiviordo-v5";
const RACINE = new URL("./", self.location).pathname;

const FICHIERS_APPLICATION = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/style.css",
  "./assets/app.js",
  "./assets/logique.js",
  "./assets/icone-192.png",
  "./assets/icone-512.png"
];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(FICHIERS_APPLICATION))
      .then(() => self.skipWaiting())
      .catch((erreur) => console.warn("Pré-cache incomplet", erreur))
  );
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((nom) => nom !== VERSION).map((nom) => caches.delete(nom))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;

  const url = new URL(requete.url);
  const memeOrigine = url.origin === self.location.origin;

  // Navigation : réseau d'abord, cache en secours (fonctionne hors ligne).
  if (requete.mode === "navigate") {
    evenement.respondWith(
      fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put("./index.html", copie));
          return reponse;
        })
        .catch(() => caches.match("./index.html").then((cache) => cache || caches.match("./")))
    );
    return;
  }

  if (!memeOrigine) {
    // Ressources externes (moteur OCR) : cache après le premier téléchargement.
    if (/jsdelivr|unpkg|tessdata|tesseract/i.test(url.hostname + url.pathname)) {
      evenement.respondWith(
        caches.match(requete).then(
          (enCache) =>
            enCache ||
            fetch(requete).then((reponse) => {
              const copie = reponse.clone();
              caches.open(VERSION).then((cache) => cache.put(requete, copie));
              return reponse;
            })
        )
      );
    }
    return;
  }

  // Ressources locales : cache immédiat, mise à jour en arrière-plan
  // (l'utilisateur voit la version en cache, le réseau rafraîchit pour la visite suivante).
  evenement.respondWith(
    caches.match(requete).then((enCache) => {
      const depuisReseau = fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(requete, copie));
          return reponse;
        })
        .catch(() => enCache);
      return enCache || depuisReseau;
    })
  );
});

// Le préfixe sert au périmètre du service worker (sous-dossier GitHub Pages).
self.MONSUIVIORO_RACINE = RACINE;
