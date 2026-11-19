# Kube City

Un jeu d'action en monde ouvert, en **3D dans le navigateur** (Three.js + physique Rapier) : trois personnages jouables dans une ville néon de 1,2 km de côté, des voitures à conduire, des piétons, une police qui vous traque, des missions et des activités. Tout est **non létal** : batte en mousse, taser, paintball, et les PNJ tombent « K.-O. ». La partie est **multijoueur** et des **agents IA** peuvent rejoindre la ville par **MCP** pour se balader, discuter et défier les joueurs.

Le vrai sujet n'est pas le jeu : c'est de le **garder en ligne quoi qu'il arrive** sur Kubernetes. On met à jour, on tue des pods, on vide un nœud… et les joueurs ne doivent rien remarquer.

> Jeu original créé pour un cours (CESI, MAALSI, INFAL127). Il n'est affilié à aucun éditeur de jeu vidéo.

![Le HUD affiche le pod qui vous sert, la version et vos reconnexions](docs/hud.png)

## Ce qui rend le jeu « HA »

| Principe | Dans le code |
|---|---|
| Pods sans état | Positions, scores, chat, courses et agents IA sont dans **Redis** (`src/store.js`). |
| Diffusion entre pods | Chaque pod publie et écoute sur un canal **Pub/Sub Redis** : un joueur servi par le pod A voit ceux du pod B. |
| Un seul simulateur d'agents | **Élection de leader** par bail Redis (`SET NX PX`, renouvelé chaque seconde). Si le leader meurt, un autre reprend en ~4 s. |
| Arrêt propre | Sur `SIGTERM` : `/readyz` passe en 503, le pod attend `DRAIN_DELAY_MS`, prévient les joueurs, ferme les WebSocket (code 1012). |
| Reconnexion invisible | Le navigateur garde sa partie et se reconnecte seul sur un autre pod (attente aléatoire croissante). |
| La HA se voit | Le HUD affiche le pod qui vous sert, la version, le ping, le nombre de reconnexions et le leader IA. |
| Mesurable | `scripts/sonde.mjs` calcule la disponibilité réelle pendant les épreuves. |

**Le point faible, c'est Redis.** Le chart peut lancer un Redis simple pour démarrer (`redis.enabled=true`), mais c'est un point de défaillance unique. Pour viser 100 % : une base Redis managée en haute disponibilité, ou Redis avec Sentinel.

## Jouer en local (3 « pods » + Redis + répartiteur)

```bash
docker compose up --build
# http://localhost:8080
```

Dans un autre terminal, arrêtez un pod pendant que vous jouez :

```bash
docker compose stop game-2      # le HUD passe sur un autre pod, la partie continue
docker compose start game-2
```

Les touches, les persos et les missions sont décrits plus bas ([Le jeu](#le-jeu)).

Sans Docker : `npm ci`, `npm run build:client`, un Redis local, puis `REDIS_URL=redis://localhost:6379 npm start`.

## Le jeu

### Les trois personnages

On commence avec Inès ; on change de perso à tout moment (Alt maintenu → roue des persos, transition caméra aérienne). Chacun a son argent, ses missions et une **capacité spéciale** (touche G, jauge qui se recharge) :

| Perso | Profil | Capacité (G) |
|---|---|---|
| **Inès « Turbo » Moreau** | ancienne pilote de rallye | **Focus** : ralentit le temps (×0,5) |
| **Malik « Clé à molette » Benali** | mécano du garage de Lou, véhicules plus résistants | **Réparation express** du véhicule courant |
| **Jade Okafor** | hackeuse | **Panne de réseau** : feux au vert sur son axe, police brouillée |

### Missions et activités

- **9 missions** (3 par perso) : *Colis à 180 km/h*, *Visite non prévue*, *Course contre le Cluster* (Inès) ; *Remorquage express*, *La pièce rare*, *Vigiles en roue libre* (Malik) ; *Signal faible*, *Sur écoute*, *Brouillage* (Jade). Les marqueurs jaunes indiquent où les lancer.
- **Finale** : *Le casse du datacenter*, à trois persos, débloquée quand chacun a fini ses missions.
- **Activités** : taxi, livraisons chronométrées, courses de rue, cascades sur les rampes, kubes cachés à collectionner.
- **Boutiques** (touche E) : vêtements et armure ; **garage** : réparation, améliorations, repeinture (fait baisser la recherche).
- **Police** : 5 niveaux de recherche selon la gravité des délits vus par des témoins ; zone de recherche à quitter pour la semer ; arrestation = amende et réveil au commissariat. K.-O. = frais d'hôpital.

### Touches

| Touche | Action |
|---|---|
| Z Q S D / W A S D / flèches | se déplacer · conduire |
| Souris (cliquez dans le jeu) | regarder |
| Maj | sprint |
| Espace | saut · frein à main en véhicule |
| F | monter / descendre d'un véhicule (voler s'il y a un conducteur) · parler |
| E | entrer dans une boutique ou le garage |
| Clic gauche / clic droit | attaquer · viser |
| 1 à 4, molette, Tab maintenu | changer d'arme (la roue ralentit le temps ×0,2 et fige la caméra) |
| C | esquive |
| H · L · R · V | klaxon · phares (puis sirène) · radio suivante · caméra |
| P · M | téléphone · carte plein écran |
| Alt maintenu | roue des personnages |
| G | capacité spéciale |
| T | discussion |
| F2 · Échap | replier le panneau HA · pause |

Manette standard prise en charge (stick : bouger, RT : attaquer, Y : véhicule, Start : pause).

### Architecture du client

Le client vit dans `client/` (Vite, sortie `client/dist` servie par le serveur Node). `client/src/main.js` crée le contexte `game` puis installe les modules dans l'ordre :

| Module | Rôle |
|---|---|
| `core/` | bus d'événements (catalogue dans `core/events.js`), entrées clavier/souris/manette, boucle, physique Rapier, assets, réglages |
| `world/` | génération déterministe de la ville (`citygen.js`, module pur partagé avec le serveur), chunks, ciel, météo, eau, feux |
| `player/` | perso à la 3ᵉ personne, animations, caméra, ragdoll, nage |
| `vehicles/` | conduite (raycast vehicle), entrée/sortie, carjacking, dégâts, niveaux de détail |
| `npc/` | piétons et circulation (conduite à droite, feux) |
| `police/` | recherche, patrouilles, unités à pied, hélicoptère |
| `combat/` | corps à corps, taser, paintball, esquive, roue d'armes |
| `audio/` | moteurs, sirène, ambiance et 5 radios procédurales |
| `gameplay/` | persos, missions, activités, boutiques, sauvegarde |
| `net/` | WebSocket, interpolation des autres joueurs, reconnexion |
| `ui/` | menus, HUD, minicarte, carte, téléphone, panneau HA |

**Temps de jeu** : `core/loop.js` applique un seul facteur de ralenti, `game.time.scale`. Chaque source le pose par `game.time.setScale(source, k)` et le plus fort ralenti l'emporte (roue d'armes 0,2 > Focus 0,5). Les modules reçoivent le dt ralenti ; les entrées, la caméra, l'interface, l'audio, le réseau et le rendu s'abonnent avec `{ real: true }` et gardent le temps réel.

### Tests

```bash
npm test               # tests unitaires (node --test)
npm run build:client   # build Vite
npm run smoke          # Chrome headless : parcours complet, captures dans scripts/out/
```

Le smoke test lance le serveur local (Redis sur `REDIS_URL`, par défaut `redis://localhost:6380`), saute les menus avec `window.__quickStart()`, puis marche, monte dans une voiture (F), roule, provoque la police, ouvre la carte (M), change de perso et teste la roue d'armes. Il prend une capture à chaque étape, mesure les draw calls (`renderer.info`) et échoue à la moindre erreur console. Il utilise le GPU (Metal sur macOS) ; `SMOKE_GL=swiftshader` pour une machine sans GPU, `SMOKE_MAX_CALLS=300` pour imposer un plafond de draw calls.

## Déployer sur Kubernetes (Kapsule ou autre)

```bash
helm upgrade --install jeu ./chart/kube-city \
  --namespace jeu --create-namespace \
  --set ingress.host=jeu.mon-groupe.fr \
  --set ingress.className=traefik
```

Réglages HA du chart (`chart/kube-city/values.yaml`) :

- 3 réplicas minimum, `maxUnavailable: 0` pendant les mises à jour ;
- `topologySpreadConstraints` sur les zones et les nœuds ;
- `PodDisruptionBudget` (`minAvailable: 2`) ;
- sondes `readiness` (`/readyz`), `liveness` (`/healthz`) et `startup` ;
- `terminationGracePeriodSeconds` plus long que `DRAIN_DELAY_MS` ;
- HPA de 3 à 10 pods sur le CPU ;
- conteneur non root, système de fichiers en lecture seule.

Redis externe en HA :

```bash
kubectl -n jeu create secret generic redis-ha --from-literal=REDIS_URL='rediss://user:motdepasse@hote:6379'
helm upgrade --install jeu ./chart/kube-city -n jeu --set redis.enabled=false --set redis.existingSecret=redis-ha
```

## Tenir la charge

Simulateur de joueurs (WebSocket protocole v2, sans navigateur) : ils se déplacent, la moitié conduit, et 3 agents IA roulent via MCP.

```bash
docker compose up -d --build
node scripts/charge.mjs --players 60 --agents 3 --duration 60 --docker
# avec chaos (variante Sentinel) : tue le maître Redis à 20 s, un pod de jeu à 40 s
export COMPOSE_FILE=docker-compose.yml:deploy/sentinel/docker-compose.sentinel.yml
node scripts/charge.mjs --players 60 --duration 60 --docker --redis-service redis-a --chaos redis@20,pod@40
```

Mesuré en local (3 pods + nginx, Redis seul, 60 joueurs + 3 agents, charge et pods sur la même machine) :

| | avant | après |
|---|---|---|
| Trafic sortant total, 30 joueurs | 2,6 Mo/s | non remesuré |
| Trafic sortant total, 60 joueurs | 9,8 Mo/s (8,6 Ko/snap, 60 entrées) | 4,4 Mo/s (4,1 Ko/snap, 27 entrées) |
| Messages Redis Pub/Sub (60 joueurs) | ~900/s (1 par état) | ~45/s (1 lot par pod et par tick) |
| Latence état → snapshot p50 / p95 | 44 / 73 ms | 45 / 72 ms |
| Écart entre snapshots p99 | 80 ms | 78 ms |
| CPU par pod (60 joueurs) | 11-16 % | 14-17 % (bruit de mesure) |
| Mémoire par pod | 68 Mo | 80 Mo |

Avec le chaos (Sentinel, 60 joueurs) : tuer le maître Redis = **0 coupure**, latence inchangée ; tuer brutalement un pod (`docker compose kill`) = 21 joueurs (ceux du pod) coupés puis reconnectés en **317 ms (médiane), 840 ms (max)**. À 120 joueurs : ~16 Mo/s, 15 % de CPU par pod, 0 coupure.

Ce qui a changé côté serveur :
- **Lots Pub/Sub** : chaque pod regroupe l'état de ses joueurs en un seul message Redis par tick (au lieu d'un par joueur et par message reçu), applique tout de suite l'état en local et ignore l'écho de son propre lot. Sans Redis (bascule), plus de commandes en file d'attente : on garde la vue locale, rien ne s'empile ni ne se rejoue après la bascule.
- **Intérêt par distance** : au-delà de 300 m (`NEAR_M`), un joueur n'est mis à jour qu'à 3,75 Hz ; le snapshot complet toutes les 2 s reste complet. Chaque entrée est sérialisée une seule fois. Protocole client inchangé.
- **Contre-pression WebSocket** : un client lent (> 256 Ko en attente) saute des snapshots puis reçoit un snapshot complet ; au-delà de 4 Mo ou 10 s de retard, il est coupé et se reconnecte (`pn_ws_snaps_skipped_total`, `pn_ws_slow_closed_total`).
- Mise à jour progressive : un pod ancien ignore les lots (`k: "pb"`) des nouveaux pods ; la ville est complète une fois la mise à jour finie.

Chart : `requests` 200m CPU / 160Mi, limite mémoire 320Mi, pas de limite CPU. Le HPA (70 % de la requête, soit 140m) se déclenche vers 60 joueurs au total sur 3 pods (mesure locale, un Kapsule sera plus lent : à revérifier avec `--docker` ou `kubectl top`) ; avec 25 étudiants on reste environ à moitié de ce seuil.

## Redis sans point faible : Sentinel

Un maître, deux réplicas, trois Sentinel. Si le maître meurt, les Sentinel promeuvent un réplica et le jeu s'y reconnecte seul.

```bash
# en local : 1 maître + 2 réplicas + 3 Sentinel + 3 pods de jeu
export COMPOSE_FILE=docker-compose.yml:deploy/sentinel/docker-compose.sentinel.yml
docker compose up --build
docker compose kill redis-a        # le maître meurt brutalement
```

Mesuré en local : **3,7 s** de synchro en pause (2 s de détection + bascule), **0 joueur déconnecté**, 100 % de disponibilité HTTP. Pendant la bascule, chacun continue de rouler et le HUD affiche « Synchro en pause ».

### Preuve avec le vrai client (objectif : bascule détectée en 1-2 s, coupure ≤ 5 s)

```bash
export COMPOSE_FILE=docker-compose.yml:deploy/sentinel/docker-compose.sentinel.yml
docker compose up -d --build
SENTINEL=1 node scripts/playtest/multi.mjs      # code de sortie 1 si une mesure dépasse 5 s ou si de la progression est perdue
```

Deux navigateurs (sur deux pods différents) + 20 joueurs simulés (`scripts/charge.mjs`), qui enchaînent : kill du maître Redis, kill d'un pod de jeu, `docker compose restart` d'un pod (mise à jour simulée), kill du nouveau maître. Mesuré côté navigateur (local, 19/11/2026) :

| Épreuve | Bascule Redis | Synchro en pause | Coupure joueur | Autre joueur invisible | Reconnexions (A / B) | Argent et missions |
|---|---|---|---|---|---|---|
| 1. kill du maître Redis | 3,3 s | 3,8 s | 0 s | 0 s | 0 / 0 | intacts |
| 2. kill d'un pod de jeu | - | 0 s | 0,1 s | 0 s | 1 / 0 | intacts |
| 3. restart d'un pod (mise à jour) | - | 0 s | 0,2 s | 0 s | 0 / 1 | intacts |
| 4. kill du nouveau maître | 3,4 s | 3,8 s | 0 s | 0 s | 0 / 0 | intacts |

Joueurs simulés : 20/20 connectés à la fin, 15 reconnexions (médiane 234 ms, max 829 ms) pour les deux pods perdus. La bascule Redis (2 s de détection + élection) reste sous les 5 s ; personne n'est coupé. Les deux joueurs ne disparaissent pas l'un pour l'autre : leur dernier état reste affiché (figé) pendant la bascule.

Corrigé grâce à cette épreuve : ioredis pouvait passer définitivement en « end » si l'annonce d'un nouveau maître tombait pendant qu'il cherchait déjà le maître (le pod restait sans Redis jusqu'à son redémarrage, `synchro en pause` 48 s et plus) : `src/store.js` relance maintenant la connexion. Pendant une coupure Redis, les joueurs des autres pods sont gardés figés (au lieu d'être retirés après 6 s) et le délai ne repart qu'au retour de Redis (`isStale` dans `src/protocol.js`). Republier l'état au retour de Redis n'apporte rien : chaque client envoie déjà son état à 15 Hz, donc les autres pods le revoient dans les 70 ms.

Ce qui rend ça possible :
- `/readyz` ne dépend PAS de Redis : sinon tous les pods deviendraient « pas prêts » en même temps pendant la bascule et le Service couperait tout le monde ;
- côté appli (`src/store.js`) : `failoverDetector` (écoute l'annonce du nouveau maître), délais courts (`commandTimeout`, reconnexion toutes les 100 ms), reconnexion sur l'erreur `READONLY` ;
- côté Sentinel : `down-after-milliseconds 2000` (plus bas, une micro-coupure réseau déclenche une bascule inutile).

Sur Kubernetes, avec un Redis + Sentinel installé par Helm (chart à choisir et vérifier, par exemple Bitnami avec `sentinel.enabled=true` et un délai de détection réglé à 2 s) :

```bash
helm upgrade --install jeu ./chart/kube-city -n jeu \
  --set redis.enabled=false \
  --set-string 'redis.sentinel.hosts=hote-sentinel-0:26379\,hote-sentinel-1:26379\,hote-sentinel-2:26379' \
  --set redis.sentinel.masterName=mymaster \
  --set redis.sentinel.passwordSecret=nom-du-secret   # Secret avec la clé REDIS_PASSWORD
```

Persistance : chaque pod Redis a son propre disque (RWO, pas besoin de RWX), avec `appendonly`. Il ne sert que si les trois pods Redis redémarrent en même temps ; la réplication couvre la perte d'un pod.

## Pour l'enseignant : la page /status

Ouvrez `https://<hôte du groupe>/status` (vidéoprojecteur : thème sombre, gros caractères, rafraîchie toutes les 2 s). Le JSON brut est sur `/api/status`.

- **Pods vivants** : un battement Redis toutes les 2 s par pod (nom, version, joueurs, uptime, Redis vu par ce pod), valable 6 s. Un pod sans battement n'apparaît plus.
- **Leader des agents**, **rôle et adresse du Redis** joint (maître, nombre de réplicas), joueurs et agents IA.
- **Disponibilité 30 min** : part des créneaux de 4 s où au moins un pod est prêt ET voit Redis, calculée depuis les battements (un créneau sans aucun battement compte comme coupé). Elle part du premier battement : un cluster neuf n'affiche pas 0 %.
- **Journal des incidents** (30 dernières minutes, conservé dans Redis) : pod apparu, pod disparu sans arrêt propre (kill, crash, nœud perdu), pod arrêté proprement (SIGTERM), coupure Redis vue par un pod avec sa durée au retour.
- **Redis coupé** : la page affiche un bandeau rouge et ne montre que ce que sait le pod qui répond (son battement, son journal local, le dernier score connu). Les autres pods et le leader sont alors inconnus : c'est normal.
- **Si la page ne répond plus**, aucun pod ne sert le groupe : c'est une panne totale.

Lien avec le barème (voir le tableau de `deploy/kapsule/README.md`) : le score donne un ordre de grandeur de la disponibilité HTTP ; le journal sert à vérifier une épreuve de chaos (kill d'un pod, du maître Redis, drain) et le temps de bascule (durée de coupure Redis). La mesure officielle reste la sonde via l'Ingress, pas ce score.

## Endurance (une journée de cours)

`scripts/soak.mjs` (serveur : 40 joueurs qui partent et reviennent avec un nouvel identifiant toutes les ~45 s, agents MCP, chaos toutes les 4 min — kill pod, kill du maître Redis, restart pod — relevé chaque minute de la mémoire des pods, des clés Redis et de la latence) et `scripts/soak-client.mjs` (Chrome headless : marche, voiture, panneaux, changement de perso, police, pannes de pod ; heap JS après GC forcé et `renderer.info.memory`). Variante Sentinel : `COMPOSE_FILE=docker-compose.yml:deploy/sentinel/docker-compose.sentinel.yml REDIS_SERVICE=auto node scripts/soak.mjs --minutes 25`.

- **Serveur, 25 min** : RSS des pods 66-75 → 72-78 Mo (heap 31-37 → 30-34 Mo, handles stables), Redis ~100 clés stables, latence état→snapshot p50/p95 ≈ 40/70 ms du début à la fin. Rien ne monte sans redescendre côté pods. Seul le classement (`pn:scores` + `pn:names`) grossissait sans fin (+30 entrées/min, un id neuf par visiteur, sans TTL) : il est maintenant plafonné à ~2 000 joueurs et expire après 7 jours sans activité. Le journal de disponibilité (`pn:hbh`) atteint sa fenêtre de 30 min puis plafonne : c'est voulu.
- **Client, 15 min** : textures GPU 85 → 956 (fuite : la `boneTexture` de chaque squelette de joueur parti n'était jamais libérée, `Skeleton.dispose()` manquait) ; après correction 85 → ~185 et stable. Géométries 135 → 1 316 et véhicules 72 → 172 avant correction (les épaves de la circulation gardaient leur faux conducteur PNJ et ne disparaissaient jamais) ; après correction 135 → 655 (le monde se charge autour du joueur) et 92 → 97 véhicules. Heap JS 39 → 52 Mo avant, 46 → 43 Mo après ; écouteurs DOM constants (56).

## Les épreuves de chaos

Lancez la sonde **avant** les épreuves et laissez-la tourner :

```bash
node scripts/sonde.mjs https://jeu.mon-groupe.fr
# Ctrl+C pour le bilan : disponibilité HTTP, connexion de jeu, reconnexions, pods vus
```

1. Mise à jour pendant que la classe joue : `helm upgrade … --set image.tag=1.1.0`.
2. `kubectl delete pod` au hasard, puis plusieurs d'un coup.
3. `kubectl drain` d'un nœud.
4. Suppression d'un nœud du pool (console Scaleway).
5. Montée en charge : beaucoup de joueurs et d'agents IA.

## Brancher un agent IA (MCP)

Le serveur MCP est sur `/mcp` (HTTP « streamable », sans session : n'importe quel pod peut répondre). Les agents apparaissent en ville comme des joueurs : voiture, nom avec un badge **IA** vert, messages de chat avec le badge IA, emotes visibles.

**Claude Code**

```bash
claude mcp add --transport http kube-city https://jeu.mon-groupe.fr/mcp \
  --header "X-Kube-Key: prenom-nom"
```

**Claude Desktop** (`claude_desktop_config.json`, via le pont `mcp-remote`) :

```json
{
  "mcpServers": {
    "kube-city": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://jeu.mon-groupe.fr/mcp", "--header", "X-Kube-Key: prenom-nom"]
    }
  }
}
```

Autre client (Cursor, SDK…) : URL `https://…/mcp`, transport HTTP, `POST` JSON-RPC. Si l'instance est protégée (`mcp.token`), ajoutez `--header "Authorization: Bearer …"`.
`X-Kube-Key` est facultatif : c'est votre pseudo, il évite que des élèves derrière la même box se partagent le quota d'agents.

Puis demandez par exemple : « Crée un agent nommé Turbo, regarde autour de toi, va à la plage et propose une course vers le phare. »
Les agents roulent sur les vraies rues de la ville (`src/city.js` réutilise la génération du client).

**Outils**

| Outil | Rôle |
|---|---|
| `spawn_agent`, `my_agents`, `despawn_agent` | créer, lister, retirer ses agents |
| `list_places`, `get_map` | lieux et plan de la ville (x/z en mètres, -600 à 600) |
| `look`, `nearby_players` | position, joueurs proches (x/z, humain ou IA), courses ouvertes, chasse en cours, chat, classement |
| `drive_to`, `drive_to_xy` | rouler vers un lieu nommé ou des coordonnées |
| `say`, `emote` | chat (badge IA) et emotes (`salut`, `danse`, `bravo`, `rire`) |
| `propose_race`, `join_race`, `race_status` | courses communes : proposer, rejoindre (même celle d'un humain, à moins de 200 m du départ, avant le départ), suivre le classement |
| `hunt_status`, `collect_kube` | chasse aux kubes dorés (toutes les ~10 min) : position des kubes, ramassage |
| `leaderboard` | scores et classement de la session |

**Limites (protection du cluster)** : 3 agents par clé (en-tête `X-Kube-Key` : donnez une clé différente à chaque étudiant), 40 par IP et 40 au total, 40 créations/min, 1 message de chat toutes les 3 s par agent (120/min par IP), 1 emote/s, 1 proposition de course/20 s (6 courses ouvertes max), 3000 requêtes MCP/min par IP (limites par IP larges : toute une classe sort souvent par la même IP), un agent n'est pilotable que par son créateur, inactif 30 min il disparaît. Réglables : `MCP_MAX_BOTS_PER_KEY`, `MCP_MAX_BOTS_PER_IP`, `MCP_MAX_BOTS`, `MCP_RPM`, `MCP_SPAWN_PER_MIN`, `MCP_CHAT_PER_MIN`, `MCP_MAX_OPEN_RACES`. Compteurs dans Redis : valables pour tous les pods. Derrière un proxy, l'IP est l'entrée de `X-Forwarded-For` ajoutée par notre proxy (`TRUST_PROXY_HOPS`, défaut 1).

**3 défis pour les étudiants**

1. **Bats un humain** : ton agent gagne une course contre un joueur. Il doit repérer une course ouverte (`look`), rouler jusqu'au départ (`drive_to_xy` sur `depart`), s'inscrire à temps (`join_race`) et finir devant. Bonus : il commente la course dans le chat.
2. **Roi des kubes** : à l'annonce de Radio Kube, ton agent choisit le kube le plus proche (`hunt_status`, distances) et le ramasse avant les autres (`collect_kube`). Écris une stratégie qui bat celle de ton voisin, puis compare vos scores dans `leaderboard`.
3. **Le maître de cérémonie** : un agent bavard mais poli qui accueille les nouveaux joueurs (`nearby_players`, `say`, `emote`), organise une course par quart d'heure vers un lieu différent et annonce le podium. Interdit : spam, insultes, usurper Radio Kube.

## Points d'accès

| Chemin | Rôle |
|---|---|
| `/` | le jeu |
| `/ws` | WebSocket de jeu |
| `/mcp` | serveur MCP |
| `/healthz` | vivant (liveness) |
| `/readyz` | prêt à recevoir du trafic (readiness) : pas en arrêt (volontairement indépendant de Redis) |
| `/metrics` | métriques Prometheus (`pn_clients_connected`, `pn_is_leader`…) |
| `/api/info` | pod, version, leader |

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis partagé |
| `PORT` | `8080` | port HTTP |
| `POD_NAME` | nom d'hôte | nom affiché dans le HUD |
| `APP_VERSION` | `dev` | version affichée (fixée au build de l'image) |
| `DRAIN_DELAY_MS` | `5000` | attente entre « plus prêt » et la fermeture des WebSocket |
| `MCP_TOKEN` | vide | jeton exigé sur `/mcp` |
| `MCP_MAX_BOTS_PER_KEY` / `_PER_IP` / `MCP_MAX_BOTS` | 3 / 8 / 40 | plafonds d'agents IA |
| `MCP_RPM`, `MCP_SPAWN_PER_MIN`, `MCP_CHAT_PER_MIN`, `MCP_MAX_OPEN_RACES` | 240, 6, 15, 6 | anti-spam MCP |

Licence MIT.
