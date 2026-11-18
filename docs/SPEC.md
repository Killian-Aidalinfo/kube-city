# Kube City v2 — Spécification

Jeu de ville en monde ouvert, en 3D, à la troisième personne, multijoueur, dans le navigateur. On incarne un personnage à pied qui peut monter dans n'importe quelle voiture, provoquer la police, faire des missions, des courses et des activités. Le jeu tourne sur Kubernetes en haute disponibilité : c'est le support d'une journée de cours (CESI, MAALSI).

Règles de propriété intellectuelle (non négociables) :
- Jeu ORIGINAL, inspiré du **genre** « monde ouvert criminel » et de ses mécaniques classiques.
- Interdit : les noms, personnages, villes, cartes, logos, musiques, dialogues, missions ou visuels d'un jeu existant (aucune mention de GTA, Rockstar, Los Santos, etc., dans le code, les textes ou les fichiers).
- Assets 3D et textures : uniquement des sources **CC0** (Kenney, Quaternius, Poly Haven, ambientCG) ou générés par le code. Chaque asset ajouté est listé dans `client/public/assets/LICENSES.md` (nom, auteur, URL, licence).

Ton : fun, arcade, un peu décalé. Public : étudiants en informatique. Pas d'armes à feu réalistes : armes **stylisées et non létales** (paintball, taser, batte en mousse, poings). Les PNJ « tombés » sont « K.O. », jamais de sang.

---

## 1. Pile technique

| Domaine | Choix |
|---|---|
| Rendu | Three.js r18x (paquet `three` npm) |
| Physique | Rapier 3D (`@dimforge/rapier3d-compat`, WASM inclus) |
| Build client | Vite, sortie dans `client/dist`, servie par le serveur Node |
| Langage | JavaScript ES modules + JSDoc (pas de TypeScript, pour la vitesse) |
| Serveur | le serveur Node existant (`src/`), WebSocket `ws`, Redis, MCP |
| Assets | glTF/GLB (`GLTFLoader`, `DRACOLoader` si besoin), textures PNG/JPG/KTX2 |
| Tests | `node --test` pour la logique pure ; Playwright (`playwright-core` + Chrome système) pour le smoke test |

Cibles de performance : 60 i/s sur un portable avec GPU intégré (MacBook Air M1, Intel Iris Xe) en 1080p ; chargement initial < 15 Mo hors cache ; < 300 draw calls à l'écran (instancing, fusion des géométries statiques par chunk).

## 2. Arborescence et propriété des modules

Chaque agent ne modifie QUE ses dossiers. Le câblage entre modules passe par le contrat de la section 3.

```
client/
  index.html, vite.config.js, package.json (workspace) 
  public/assets/            ← assets CC0 (modèles, textures, sons) + LICENSES.md   [FONDATION]
  src/
    main.js                 ← amorçage, ordre d'installation des modules             [FONDATION]
    core/                   ← boucle, rendu, entrées, bus d'événements, physique, assets, réglages [FONDATION]
    world/                  ← ville 3D, routes, cycle jour/nuit, météo, eau          [MONDE]
    player/                 ← personnage, animations, caméra 3e personne, à pied     [JOUEUR]
    vehicles/               ← véhicules, conduite, entrer/sortir, dégâts, radio      [VÉHICULES]
    npc/                    ← piétons, circulation, feux tricolores                  [PNJ]
    police/                 ← niveau de recherche, IA de police, arrestation         [POLICE]
    combat/                 ← corps à corps, roue d'armes, armes non létales, santé  [COMBAT]
    ui/                     ← HUD, minimap, carte plein écran, téléphone, menus      [INTERFACE]
    audio/                  ← sons, moteurs, sirènes, stations de radio procédurales [AUDIO]
    gameplay/               ← missions, activités, argent, boutiques, persos jouables [GAMEPLAY]
    net/                    ← client réseau, autres joueurs, reconnexion HA          [RÉSEAU]
src/                        ← serveur Node (existant, étendu)                        [RÉSEAU]
test/                       ← tests node --test par module (chaque agent ajoute les siens)
scripts/smoke.mjs           ← smoke test Playwright                                  [FONDATION]
```

## 3. Contrat entre modules (FONDATION le crée, tous le respectent)

### 3.1 Le contexte `game`

`main.js` crée un objet unique et appelle `install(game)` de chaque module dans cet ordre : core → world → player → vehicles → npc → police → combat → audio → gameplay → net → ui.

```js
game = {
  three: { scene, camera, renderer },         // Three.js
  physics: { world, RAPIER },                  // Rapier
  bus,                                         // bus d'événements (3.2)
  input,                                       // état des entrées (3.3)
  assets,                                      // chargeur avec cache (3.4)
  settings,                                    // réglages (qualité, son, sensibilité), persistés en localStorage
  time: { now, dt, elapsed, dayTime },         // dayTime ∈ [0, 24)
  world: null,     // rempli par MONDE : { roads, query(...), spawnPoints, … } (3.5)
  player: null,    // rempli par JOUEUR (3.6)
  vehicles: null,  // rempli par VÉHICULES (3.7)
  npc: null, police: null, combat: null, audio: null, gameplay: null, net: null, ui: null,
  onUpdate(fn, order = 0),   // fn(dt) appelée chaque image, triée par order (physique = 0, IA = 10, caméra = 90, UI = 100)
  state: 'menu' | 'playing' | 'paused' | 'cutscene',
}
```

Chaque module exporte `export function install(game) { … }` et range son API publique dans `game.<module>`. Un module ne touche jamais aux objets internes d'un autre : il passe par l'API publique ou le bus.

### 3.2 Bus d'événements

`game.bus.on(type, fn)`, `game.bus.off(type, fn)`, `game.bus.emit(type, payload)`. Liste des événements (la FONDATION les déclare dans `core/events.js` avec leur payload documenté) :

| Événement | Émis par | Payload |
|---|---|---|
| `player:spawned` | JOUEUR | `{ character }` |
| `player:enterVehicle` / `player:exitVehicle` | VÉHICULES | `{ vehicle, seat }` |
| `player:damaged` / `player:ko` | COMBAT | `{ amount, source }` / `{ cause }` |
| `player:respawn` | GAMEPLAY | `{ where: 'hôpital'|'commissariat', cost }` |
| `vehicle:spawned` / `vehicle:destroyed` | VÉHICULES | `{ vehicle }` |
| `vehicle:collision` | VÉHICULES | `{ vehicle, other, impulse }` |
| `crime` | tous | `{ kind: 'carjack'|'hitPed'|'assault'|'speedingNearCop'|'shootCop'|'vandalism', severity, position }` |
| `wanted:changed` | POLICE | `{ level, previous }` |
| `wanted:busted` | POLICE | `{}` |
| `money:changed` | GAMEPLAY | `{ amount, delta, reason }` |
| `mission:started` / `mission:objective` / `mission:passed` / `mission:failed` | GAMEPLAY | `{ id, title, text }` |
| `notify` | tous | `{ text, kind: 'info'|'success'|'warning'|'danger', duration }` |
| `subtitle` | tous | `{ speaker, text, duration }` |
| `character:switch` | GAMEPLAY | `{ from, to }` |
| `net:status` | RÉSEAU | `{ connected, pod, version, reconnects, ping, leader }` |
| `radio:station` | AUDIO | `{ name }` |
| `ui:waypoint` | INTERFACE | `{ position }` ou `null` |

### 3.3 Entrées

`game.input` expose : `isDown(action)`, `pressed(action)` (vrai une seule image), `axis('moveX'|'moveY'|'lookX'|'lookY')`, `pointerLocked`. Actions (clavier/souris + manette standard via Gamepad API) :

| Action | Clavier/souris | Manette |
|---|---|---|
| avancer/reculer/gauche/droite | ZQSD **et** WASD **et** flèches | stick gauche |
| regarder | souris (pointer lock) | stick droit |
| sprint | Maj | A maintenu / L3 |
| saut | Espace | X/A |
| entrer/sortir véhicule | F | Y/Triangle |
| frein à main | Espace (en véhicule) | RB |
| attaque / tirer | clic gauche | RT |
| viser | clic droit | LT |
| roue d'armes | Tab maintenu | LB |
| klaxon | H | L3 en véhicule |
| radio suivante | R (en véhicule) | D-pad gauche/droite |
| phares | L | D-pad bas |
| changer de caméra | V | Select/Back |
| téléphone | ↑ (flèche haut) ou P | D-pad haut |
| carte | M | Select long |
| changer de perso | Alt maintenu → roue des persos | D-pad bas long |
| chat | T | — |
| pause | Échap | Start |

### 3.4 Assets

`game.assets.loadGLTF(url)`, `loadTexture(url)`, `clone(gltf)` (avec `SkeletonUtils.clone` pour les modèles animés), cache par URL, barre de progression émise via `bus.emit('assets:progress', {loaded, total})`. Le manifest des assets est `client/public/assets/manifest.json` (chemins, échelle, orientation, nom des animations).

### 3.5 Monde (API attendue)

`game.world = { size, chunks, roads: RoadGraph, sidewalks, spawnPoints: { player, vehicles[], peds[] }, places: { [key]: { label, position } }, groundHeight(x, z), isRoad(x, z), nearestRoadPoint(p), route(from, to) → points[], trafficLights[], district(x, z) → { name, color } }`

`RoadGraph` : nœuds (intersections) et arêtes (voies, sens, vitesse limite), utilisé par la circulation, le GPS et la police.

### 3.6 Joueur (API attendue)

`game.player = { object3d, body, character, state: 'onFoot'|'enteringVehicle'|'inVehicle'|'exitingVehicle'|'ragdoll'|'ko'|'swimming', health, armor, stamina, vehicle, position, velocity, setCharacter(id), teleport(p), applyDamage(n, source) }`

### 3.7 Véhicules (API attendue)

`game.vehicles = { list, spawn(type, position, rotation, opts) → Vehicle, nearestEnterable(position, radius) → { vehicle, seat } | null, enter(actor, vehicle, seat), exit(actor), types }` ; `Vehicle = { id, type, object3d, chassis (Rapier body), driver, passengers, speed (km/h), health, engineOn, lights, siren, owner: 'player'|'npc'|'police'|'remote', setControls({throttle, brake, steer, handbrake}) }`.

## 4. Assets CC0 à récupérer (FONDATION)

Télécharger, extraire, ne garder que le nécessaire (glb + textures), convertir si besoin, réduire la taille (pas de 4K), et documenter dans `LICENSES.md` :

1. **Personnages animés** : Quaternius — *Universal Animation Library* (animations humanoïdes : idle, walk, run, sprint, jump, fall, punch, kick, sit/drive, death, crouch…) et un ou plusieurs packs de personnages humanoïdes CC0 compatibles (Quaternius *Ultimate Modular Men/Women*, *Animated Characters*, *Mini characters* de Kenney). Il faut au moins **3 personnages jouables distincts** + **8 variantes de piétons** (couleurs/vêtements différents), tous avec un squelette compatible avec les animations retenues. Si les squelettes diffèrent, choisir un seul pack cohérent.
2. **Véhicules** : Kenney *Car Kit* (berline, sport, SUV, pick-up, camionnette, taxi, police, ambulance, camion de pompiers, bus…). Roues séparées si possible (sinon, détecter les nœuds de roues par leur nom).
3. **Ville** : Quaternius *Downtown City MegaKit* et/ou Kenney *City Kit (Roads, Commercial, Suburban)* : immeubles, routes, trottoirs, lampadaires, feux, arbres, bancs, panneaux.
4. **Textures** : Poly Haven ou ambientCG (asphalte, béton, herbe, sable, eau), en 1K.
5. **Sons** : Kenney *Impact Sounds*, *Interface Sounds* (CC0). Les moteurs, sirènes et musiques de radio sont **synthétisés** par AUDIO (Web Audio), pas téléchargés.

Sources de référence pour le code (lire, s'inspirer, ne pas copier en bloc sans respecter la licence) : `swift502/Sketchbook` (MIT : personnage 3e personne, entrée dans les véhicules, caméra), exemples officiels Rapier (`DynamicRayCastVehicleController`, `KinematicCharacterController`).

Si un téléchargement échoue (site bloqué), le module concerné doit avoir un **repli procédural** (formes simples colorées) pour que le jeu reste jouable.

## 5. Monde — Kube City

- Ville côtière fictive d'environ **1,2 km × 1,2 km**, découpée en chunks de 100 m (chargement/déchargement selon la distance, fusion des géométries statiques par chunk).
- **Quartiers** (couleur dominante, ambiance) :
  - *Centre* : tours, places, néons, beaucoup de piétons.
  - *Docks* : entrepôts, conteneurs, grues, grandes avenues.
  - *Collines* : villas, routes sinueuses en pente, belvédère.
  - *Plage* : promenade, palmiers, sable, jetée, eau animée.
  - *Zone industrielle / aéroport* (plat, grandes lignes droites pour les courses).
- Grille de rues de base + quelques routes non orthogonales (corniche, route des collines) ; carrefours avec **feux tricolores** fonctionnels ; trottoirs surélevés ; passages piétons.
- Génération **déterministe** (graine fixe) : le serveur et tous les clients ont la même ville. Code de génération partagé : `client/src/world/citygen.js` importable aussi par Node (pas de dépendance au DOM).
- **Cycle jour/nuit** : 1 journée de jeu = 24 min réelles ; soleil, ciel (Sky shader ou dégradé), lampadaires et vitrines qui s'allument la nuit, phares. **Météo** : soleil, nuageux, pluie (particules, route mouillée plus glissante).
- **Lieux nommés** (pour missions, GPS, agents IA) : mairie, commissariat, hôpital, garage « Chez Lou », boutique de vêtements, jetée, phare, stade, belvédère, port, aéroport, planque de chaque perso.
- **Collisions** : immeubles (boîtes), trottoirs, sol, eau (zone de nage), rampes de cascade.

## 6. Personnage et caméra

- Contrôleur de personnage cinématique Rapier (`KinematicCharacterController`) : marcher, courir, **sprint avec endurance**, sauter, tomber (dégâts de chute au-delà de 6 m), monter les marches/trottoirs (autostep), glisser sur les pentes raides, **nager** (vitesse réduite, endurance).
- Animations mélangées (`AnimationMixer`, crossfade 0,15–0,25 s) : idle, marche, course, sprint, saut, chute, atterrissage, coup de poing, esquive, visée, entrée/sortie de véhicule (ouvrir la porte, s'asseoir), assis en conduisant, K.O.
- **Ragdoll simplifié** quand on est percuté par une voiture ou qu'on tombe de haut : le corps devient un objet physique (capsule) qui roule, puis le perso se relève.
- **Caméra 3e personne** : orbite souris/stick autour du perso, distance 4 m (à pied), recentrage automatique derrière le perso en mouvement, **collision caméra** (raycast contre le décor, la caméra se rapproche au lieu de traverser les murs), épaule droite quand on vise. En véhicule : caméra de poursuite qui suit la vitesse (recul et FOV augmentent avec la vitesse), 3 modes avec V (proche, éloignée, capot).
- Interaction contextuelle : invite « F : Monter » près d'un véhicule, « F : Parler » près d'un PNJ de mission, « E : Entrer » devant une boutique.

## 7. Véhicules

- `DynamicRayCastVehicleController` de Rapier (ou suspension par raycasts maison) : 4 roues, suspension, adhérence, **frein à main qui fait déraper**, transfert de masse, retournement possible (le joueur peut sortir et le véhicule se remet droit après 3 s s'il est retourné sans conducteur).
- **Catégories** avec réglages différents (masse, puissance, vitesse max, adhérence) : compacte, berline, sport, muscle, SUV, pick-up, camionnette, taxi, bus, **police**, ambulance, **moto** (si modèle dispo : inclinaison dans les virages, chute au choc). Stretch goal : bateau sur l'eau.
- **Entrer/sortir (F)** : le perso marche vers la porte la plus proche, animation d'ouverture, s'assoit. Si un PNJ conduit : **carjacking** (le PNJ est éjecté, s'enfuit ou se bat ; crime → recherche +1 si témoin ou police proche). Sortie en marche > 30 km/h = roulade au sol.
- **Dégâts** : santé du véhicule, carrosserie qui se déforme légèrement ou se salit, fumée sous 30 %, feu sous 10 % (le joueur doit sortir), le véhicule devient une épave (pas d'explosion gore : flash + fumée).
- Klaxon, phares, clignotants auto, **sirène** et gyrophares (véhicules de police/ambulance si le joueur y monte), feux stop.
- **Radio** en véhicule : 5 stations originales générées par AUDIO (synthwave, lo-fi, techno, rock synthétique, talk-show en texte qui défile) ; nom de la station affiché au changement.
- **Garage « Chez Lou »** : réparer, repeindre (couleurs), petites améliorations (moteur, freins, suspension) contre de l'argent ; le véhicule peut être enregistré comme **véhicule personnel** (réapparaît près de la planque, persisté côté serveur).

## 8. PNJ

- **Piétons** : marchent sur les trottoirs (graphe de trottoirs), traversent aux passages, réagissent (fuient si on roule sur le trottoir, si on se bat ; appellent la police = crime signalé avec délai ; certains ripostent au corps à corps) ; quelques lignes de dialogue en sous-titre quand on les bouscule. Densité selon le quartier et l'heure.
- **Circulation** : véhicules PNJ qui suivent les voies du `RoadGraph`, respectent les feux et les distances, klaxonnent, freinent devant un obstacle, contournent une épave, fuient si on les menace.
- Pool d'objets et **LOD** : au-delà de 150 m, PNJ masqués ou remplacés par des imposteurs ; nombre max configurable (qualité basse/moyenne/haute).
- Tout est **local au client** (non synchronisé) sauf les véhicules occupés par des joueurs.

## 9. Police et niveau de recherche (1 à 5 étoiles)

- Les crimes ajoutent de la « chaleur » ; seuils → étoiles. Témoins : un crime non vu par un policier ou un piéton n'est pas signalé.
- ★ : une patrouille vient voir ; ★★ : poursuite active, plusieurs voitures ; ★★★ : **barrages** sur les routes de fuite ; ★★★★ : **hélicoptère** avec projecteur (modèle simple si pas d'asset) ; ★★★★★ : unités d'intervention, véhicules blindés.
- **Zone de recherche** : quand la police perd le contact visuel, un cercle apparaît sur la minimap ; sortir du cercle sans être vu pendant N secondes (selon le niveau) fait perdre les étoiles (elles clignotent pendant la recherche).
- Changer de véhicule hors de vue, se cacher dans une ruelle ou passer au garage pour **repeindre** fait baisser la recherche.
- La police utilise le `RoadGraph` (route vers la dernière position connue), tente d'éperonner (PIT) à partir de ★★★, sort des voitures pour arrêter le joueur à pied.
- **Arrestation** (« Arrêté ») : perte d'argent (10 %, max 500), on réapparaît devant le commissariat. **K.O.** : on réapparaît à l'hôpital (frais 200).

## 10. Combat (non létal)

- Corps à corps : coup de poing, combo, esquive, coup de pied ; les PNJ peuvent tomber K.O. (ils se relèvent plus tard).
- **Roue d'armes** (Tab) avec ralenti du temps : poings, batte en mousse, taser (immobilise), **lanceur de paintball** (tache de couleur sur la cible, projectiles physiques), feux d'artifice (stretch).
- Visée à l'épaule (clic droit), réticule, verrouillage doux sur la cible la plus proche du réticule à la manette.
- Santé (régénère jusqu'à 50 % hors combat) et armure (achetée en boutique).
- Viser un policier ou le toucher = crime grave.

## 11. Gameplay

- **Trois persos jouables** (originaux) avec une **carte de sélection** au lancement (portrait, nom, spécialité, statistiques) et **changement de perso en jeu** (Alt maintenu → roue des persos ; transition : la caméra s'élève au-dessus de la ville puis redescend sur l'autre perso, qui était ailleurs et en train de faire quelque chose) :
  - **Inès « Turbo » Moreau** : ancienne pilote de rallye. Capacité spéciale : *Focus* (ralenti en conduite, jauge).
  - **Malik « Clé à molette » Benali** : mécano du garage de Lou. Capacité : *Réparation express* (répare le véhicule courant) et voitures plus résistantes.
  - **Jade Okafor** : hackeuse. Capacité : *Panne de réseau* (feux tricolores au vert pour elle, police brouillée quelques secondes).
  Chaque perso a son argent, sa planque, sa garde-robe, ses stats (endurance, conduite, combat) qui progressent avec l'usage.
- **Argent** : missions, courses, livraisons, taxi ; dépenses : garage, vêtements, armure, frais d'hôpital, amendes.
- **Missions** (système data-driven : fichiers JSON/JS d'objectifs enchaînés : aller à, conduire jusqu'à, suivre, semer la police, livrer, gagner une course, mettre K.O., photographier…) avec dialogues en sous-titres, GPS automatique, échec/recommencer au dernier point de passage :
  - 3 missions par perso (fil narratif léger et drôle autour de Kube City et d'un mystérieux « Cluster » qui contrôle la ville) ;
  - une mission finale **« le casse du datacenter »** qui fait alterner les 3 persos (changement imposé à des moments clés).
- **Activités** : courses de rue (points de passage, adversaires PNJ, classement), **taxi** (prendre des clients, pourboire selon la conduite), livraisons chronométrées, **cascades** (rampes marquées, ralenti au saut, bonus), objets à collectionner (50 « kubes » cachés), défis de vitesse au radar.
- **Boutiques** : vêtements (changer haut/bas/couleurs → teintes de matériaux), armure, garage.
- **Statistiques et succès** : distance parcourue, sauts, temps de recherche maximal…
- **Sauvegarde** : profil par joueur (persos, argent, véhicules perso, progression des missions) persisté côté serveur dans Redis (et en localStorage en secours).

## 12. Interface (style néon, lisible, en français)

- **HUD** : minimap ronde en bas à gauche (tourne avec la caméra, routes, blips des lieux/missions/police, cercle de recherche, itinéraire GPS), santé et armure (arcs autour de la minimap), étoiles de recherche et argent en haut à droite, arme courante, compteur de vitesse et nom de radio en véhicule, invite d'interaction, notifications en haut à gauche, sous-titres en bas, texte d'objectif de mission.
- **Panneau HA** (petit, en haut au centre, repliable) : pod qui sert, version, ping, reconnexions, leader IA (c'est le sujet du cours, il doit rester visible).
- **Carte plein écran** (M) : zoom, déplacement, légende, clic pour poser un **point GPS** (itinéraire calculé sur le RoadGraph et tracé en couleur sur la route et la minimap).
- **Téléphone** (↑) : contacts (appeler le garage pour livrer un véhicule perso, appeler un taxi), liste des missions/activités, appareil photo (selfie), paramètres, joueurs connectés.
- **Écrans** : titre, carte des persos, chargement avec astuces, pause (reprendre, carte, réglages, touches, quitter), « Arrêté » / « K.O. » (plein écran stylé, ralenti, désaturation), « Mission réussie » (récompense).
- **Réglages** : qualité graphique (ombres, distance de vue, densité PNJ), sensibilité, inversion Y, volumes (musique, effets), sous-titres.

## 13. Audio

- Web Audio API, bus de mixage (musique, effets, ambiance).
- Moteur synthétisé (oscillateurs + filtre, régime selon la vitesse et le rapport engagé, différent par catégorie), crissement de pneus au dérapage, chocs (sons CC0), klaxon, **sirène** (deux tons, doppler simple), pas, coups, ambiance de ville (circulation lointaine, mouettes à la plage, pluie).
- **5 stations de radio** à musique **générée** (séquenceur procédural, tempo et gamme par station), jingles synthétisés, nom affiché.
- Spatialisation (`PannerNode`) pour les sons du monde.

## 14. Multijoueur et HA (le cœur du cours)

- Le serveur existant reste **sans état** : tout l'état partagé dans Redis, diffusion par Pub/Sub, arrêt propre sur SIGTERM, `/healthz` `/readyz` `/metrics`, élection de leader pour les agents IA. Ces principes ne doivent pas régresser.
- Protocole WebSocket v2 (JSON, versionné `v: 2`) : `hello` (id, perso, tenue), `state` 15 Hz (position, rotation, vitesse, état d'anim, véhicule et siège, étoiles), `vehicle` (véhicule piloté par ce joueur : position, rotation, roues, couleur, sirène), `chat`, `emote`, événements de mission partagés (courses multijoueurs).
- Interpolation des autres joueurs (tampon de 100 ms), extrapolation courte, téléport si écart > 10 m.
- **Autres joueurs** : avatar avec leur perso et leur tenue, pseudo au-dessus, leur véhicule visible. PvP désactivé par défaut (les coups entre joueurs ne font pas de dégâts), collisions de véhicules entre joueurs activées.
- **Reconnexion invisible** : en cas de coupure (pod tué, mise à jour), le jeu continue localement, une petite icône clignote, reconnexion automatique avec attente aléatoire croissante ; la sauvegarde du profil est relue depuis Redis ; le panneau HA montre le changement de pod.
- Les **agents IA (MCP)** existent dans le monde 3D : ils conduisent des véhicules sur le RoadGraph (simulés par le pod leader), parlent dans le chat, proposent des courses ; outils MCP existants adaptés au monde 3D (coordonnées x/z, lieux nommés de la section 5).
- Le serveur sert `client/dist` (build Vite) ; l'image Docker fait le build en multi-étapes.

## 15. Qualité et livraison

- `npm run build` (client) et `npm test` passent ; `node scripts/smoke.mjs` ouvre le jeu dans Chrome headless, choisit un perso, marche 3 s, entre dans un véhicule, roule 5 s, ouvre la carte, et échoue s'il y a une erreur console ou un écran noir (capture d'écran conservée dans `scripts/out/`).
- Aucune erreur console en jeu normal. Pas de fuite mémoire évidente (pools d'objets, `dispose()`).
- Code commenté en français, sobrement, comme le serveur existant.
- Le chart Helm, le docker compose et la sonde HA restent fonctionnels (le jeu servi par `/` doit répondre, `/ws` aussi).

## 16. Priorités (si le temps manque)

1. **Indispensable** : ville 3D jouable, perso 3e personne + caméra, entrer/sortir/conduire, circulation et piétons simples, police ★ à ★★★, HUD + minimap + carte GPS, multijoueur + panneau HA, carte des persos, changement de perso.
2. **Important** : missions (au moins 1 par perso), courses, taxi, garage, radio, jour/nuit, combat au corps à corps + paintball, arrestation/K.O.
3. **Bonus** : hélicoptère de police, météo, moto, cascades, collectibles, mission finale du casse, bateau.
