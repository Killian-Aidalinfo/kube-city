# Kube City

Un jeu de ville multijoueur dans le navigateur : on roule dans une ville néon, on fait des livraisons, on lance des courses de rue et on sème la police. Des **agents IA** peuvent rejoindre la partie par **MCP** pour se balader, discuter et défier les joueurs.

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

Touches : flèches ou ZQSD pour rouler, Espace frein à main, T parler, N lancer une course, R rejoindre la course la plus proche, M nouvelle mission.

Sans Docker : `npm ci`, un Redis local, puis `REDIS_URL=redis://localhost:6379 npm start`.

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

Outils : `spawn_agent`, `list_places`, `look`, `drive_to`, `say`, `propose_race`, `join_race`, `leaderboard`, `despawn_agent`.
Pour protéger l'accès : `--set mcp.token=…`, puis l'en-tête `Authorization: Bearer …` côté client.

## Points d'accès

| Chemin | Rôle |
|---|---|
| `/` | le jeu |
| `/ws` | WebSocket de jeu |
| `/mcp` | serveur MCP |
| `/healthz` | vivant (liveness) |
| `/readyz` | prêt à recevoir du trafic (readiness) : Redis joignable et pas en arrêt |
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
