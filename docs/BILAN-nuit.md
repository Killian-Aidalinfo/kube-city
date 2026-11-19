# Bilan de la nuit du 18 au 19 novembre 2026

Commits `412bc9c` → `a9941cb` sur `main`. Tests : 100/100, build OK, smoke OK (60 i/s, jour ~210 draw calls, nuit ~160 depuis la moto, le bus et les pigeons).

## Jeu
- **Missions** : script `scripts/playtest/missions.mjs` (les 9 missions + casse + activités + boutique, ~4 min) ; course contre le Cluster à gagner pour de vrai ; textes et récompenses cohérents ; dialogues réécrits autour du « Cluster ».
- **Monde** : vrai datacenter dans la zone industrielle (casse et missions de Jade y mènent), lampadaires allumés la nuit, panneaux « Kube City ».
- **Conduite** : freinage progressif (~25 m de 100 à 0), direction qui s'adoucit avec la vitesse, plus de tonneau en virage. Test : `scripts/playtest/conduite.mjs`.
- **Prise en main** : pseudo, rappel des touches, astuces la première fois, menu pause (volume, sensibilité, qualité basse/moyenne/haute), gâchettes de manette en voiture.
- **Véhicules et vie** : moto (penche, peut tomber) et bus, dans la circulation et garés ; piétons qui s'écartent, s'abritent de la pluie, applaudissent les cascades ; pigeons (réactions non vérifiées à l'œil).
- **Jouer à plusieurs** : courses entre joueurs (téléphone P › Courses : compte à rebours et classement communs), « chasse aux kubes dorés » toutes les ~10 min lancée par le leader (reprise par le suivant s'il meurt), classement de la session (touche L), emotes (touches 5 à 8). Test : `scripts/playtest/social.mjs`. Les phares passent sur N.
- **Missions infra répétables** (Téléphone › Activités) : « Rolling update », « Chaos Monkey », « Le DNS, c'est toujours le DNS ».
- **Agents IA en MCP** : une IA d'étudiant peut créer jusqu'à 3 agents, conduire, faire les courses communes, la chasse aux kubes, des emotes, lire la carte ; limites partagées entre pods ; config Claude Code / Desktop et 3 défis dans le README (section MCP). Test : `scripts/playtest/mcp.mjs`. Fil de chat à l'écran avec badge « IA ».
- **Son** : pluie enfin audible, grillons la nuit, mixage sans saturation (mesuré, pas écouté : `scripts/playtest/audio.mjs`).
- **Police** : barrages à 3 étoiles, voitures qui bloquent à 4, hélicoptère avec projecteur la nuit à 5, étoiles perdues en se cachant hors du cône de vision (non testé en jeu).
- **Qualité Basse** : ~27-30 i/s en rendu logiciel (contre 10), MSAA coupé, terrain découpé en tuiles.
- **Infos cluster (touche K)** : pod qui me sert, pod précédent, latence, joueurs, leader IA, état Redis — à ouvrir pendant les pannes.

## HA et charge
- Serveur : Pub/Sub par lots, mises à jour moins fréquentes des joueurs lointains, client lent qui saute des snapshots. 60 joueurs : 9,8 → 4,4 Mo/s, Pub/Sub ~900 → ~45 msg/s.
- Accueil d'un joueur sans attendre Redis pendant une bascule : reconnexion médiane ~0,3 s (Sentinel, maître Redis puis pod tués, 30 joueurs).
- Client : sauvegarde rejouée après une coupure (plus de progression perdue), bandeau « Reconnexion au cluster… ».
- **Bug Sentinel corrigé** : si l'annonce de bascule tombait pendant qu'ioredis cherchait déjà le maître, un pod restait sans Redis jusqu'à son redémarrage (et `/readyz` le masquait). Relance automatique ajoutée.
- **Preuve avec le vrai client** (`SENTINEL=1 node scripts/playtest/multi.mjs`, 2 navigateurs + 20 joueurs simulés) : kill du maître Redis → synchro en pause 3,8 s, 0 coupure joueur ; kill / restart d'un pod → coupure 0,1-0,2 s ; argent et missions intacts. Détection Sentinel 2 s + élection ≈ 3,5 s (objectif « coupure ≤ 5 s » tenu, « 1-2 s » non).
- Pendant une coupure Redis, les joueurs des autres pods restent figés au lieu de disparaître.
- Scripts : `scripts/charge.mjs` (N joueurs + chaos), `scripts/playtest/multi.mjs` (2 navigateurs, pod tué, Redis tué).
- Kit étudiants : `deploy/kapsule/` (Kapsule une zone, Redis Sentinel Bitnami 28.3.12 en RWO `scw-bssd`, `chaos.sh`, barème HA sur 20), rejoué sur kind.

## Revues Opus
Deux revues : la seconde a corrigé une relance Redis pendant l'arrêt propre, un double prix de chasse, une course close encore gagnable et l'absence d'anti-spam.

## À vérifier avant le cours
0. **Agents IA** : donnez à chaque étudiant une clé `X-Kube-Key` différente (3 agents par clé). Les limites par IP sont larges exprès : toute la classe sort par la même IP.
1. Déployer CETTE version avant l'arrivée des étudiants : un ancien pod ne comprend pas les lots Pub/Sub des nouveaux (les rollouts suivants, même version, ne sont pas concernés).
2. `docker pull bitnami/redis:latest` et `bitnami/redis-sentinel:latest` : Bitnami ne publie plus que `latest` en gratuit.
3. Sur une vraie Kapsule : Ingress + Let's Encrypt, perte brutale d'un nœud (scénario 5) et `kubectl top` pour le HPA — non testés cette nuit.
4. À l'oreille et à la main : sons, manette, ressenti de conduite, qualité basse sur un portable sans GPU.
5. Pendant une coupure Redis, deux joueurs sur des pods différents se voient figés jusqu'au retour de Redis (normal : le Pub/Sub passe par Redis).
