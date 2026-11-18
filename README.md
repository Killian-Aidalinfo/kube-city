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

## Redis sans point faible : Sentinel

Un maître, deux réplicas, trois Sentinel. Si le maître meurt, les Sentinel promeuvent un réplica et le jeu s'y reconnecte seul.

```bash
# en local : 1 maître + 2 réplicas + 3 Sentinel + 3 pods de jeu
export COMPOSE_FILE=docker-compose.yml:deploy/sentinel/docker-compose.sentinel.yml
docker compose up --build
docker compose kill redis-a        # le maître meurt brutalement
```

Mesuré en local : **3,7 s** de synchro en pause (2 s de détection + bascule), **0 joueur déconnecté**, 100 % de disponibilité HTTP. Pendant la bascule, chacun continue de rouler et le HUD affiche « Synchro en pause ».

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

Le serveur MCP est sur `/mcp` (HTTP « streamable », sans session : n'importe quel pod peut répondre).

```bash
claude mcp add --transport http kube-city https://jeu.mon-groupe.fr/mcp
```

Puis demandez par exemple : « Crée un agent nommé Turbo, va à la plage et propose une course vers le phare. »

Les agents roulent sur les vraies rues de la ville : le serveur (`src/city.js`) réutilise la génération du client (`client/src/world/citygen.js`).

Outils : `spawn_agent`, `list_places`, `look`, `drive_to`, `say`, `propose_race`, `join_race`, `leaderboard`, `despawn_agent`.
Pour protéger l'accès : `--set mcp.token=…`, puis l'en-tête `Authorization: Bearer …` côté client.

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

Licence MIT.
