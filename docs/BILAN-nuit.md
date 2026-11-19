# Bilan de la nuit du 18 au 19 novembre 2026

Commits `412bc9c` → `a9941cb` sur `main`. Tests : 105/105, build OK, smoke OK (60 i/s, jour ~210 draw calls, nuit ~160 depuis la moto, le bus et les pigeons).

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

- **Retour à chaud du 19/11 au matin** : course (Maj ou double appui sur Avancer, 9,2 m/s, ~13 s, caméra et jauge) et deux fois plus de voitures en ville.

## HA et charge
- Serveur : Pub/Sub par lots, mises à jour moins fréquentes des joueurs lointains, client lent qui saute des snapshots. 60 joueurs : 9,8 → 4,4 Mo/s, Pub/Sub ~900 → ~45 msg/s.
- Accueil d'un joueur sans attendre Redis pendant une bascule : reconnexion médiane ~0,3 s (Sentinel, maître Redis puis pod tués, 30 joueurs).
- Client : sauvegarde rejouée après une coupure (plus de progression perdue), bandeau « Reconnexion au cluster… ».
- **Bug Sentinel corrigé** : si l'annonce de bascule tombait pendant qu'ioredis cherchait déjà le maître, un pod restait sans Redis jusqu'à son redémarrage (et `/readyz` le masquait). Relance automatique ajoutée.
- **Preuve avec le vrai client** (`SENTINEL=1 node scripts/playtest/multi.mjs`, 2 navigateurs + 20 joueurs simulés) : kill du maître Redis → synchro en pause 3,8 s, 0 coupure joueur ; kill / restart d'un pod → coupure 0,1-0,2 s ; argent et missions intacts. Détection Sentinel 2 s + élection ≈ 3,5 s (objectif « coupure ≤ 5 s » tenu, « 1-2 s » non).
- Pendant une coupure Redis, les joueurs des autres pods restent figés au lieu de disparaître.
- Scripts : `scripts/charge.mjs` (N joueurs + chaos), `scripts/playtest/multi.mjs` (2 navigateurs, pod tué, Redis tué).
- **Endurance** (`scripts/soak.mjs`, `scripts/soak-client.mjs`) : 25 min, 40 joueurs qui vont et viennent, panne toutes les 4 min → pods stables (RSS 66-78 Mo, heap plat, latence p50/p95 ≈ 40/70 ms). Corrigé : classement Redis qui grossissait sans fin (plafond ~2000 + TTL 7 j), textures de squelette jamais libérées côté navigateur (85 → 956 textures en 15 min, maintenant ~185 stable), épaves de la circulation jamais retirées. Non élucidé : 2 agents IA sur 5 non créés pendant la charge.
- Kit étudiants : `deploy/kapsule/` (Kapsule une zone, Redis Sentinel Bitnami 28.3.12 en RWO `scw-bssd`, `chaos.sh`, barème HA sur 20), rejoué sur kind.

## Pour l'enseignant
- **Page `/status`** (sur chaque cluster) : pods vivants, leader, maître Redis, joueurs et agents, journal des incidents des 30 dernières min (pod disparu sans arrêt propre, coupure Redis et sa durée), score de dispo. À projeter pendant le tour des clusters ; la mesure officielle du barème reste la sonde via l'Ingress.

## Revues Opus
Deux revues : la seconde a corrigé une relance Redis pendant l'arrêt propre, un double prix de chasse, une course close encore gagnable et l'absence d'anti-spam.

## À vérifier avant le cours
0. **Agents IA** : donnez à chaque étudiant une clé `X-Kube-Key` différente (3 agents par clé). Les limites par IP sont larges exprès : toute la classe sort par la même IP. Avec une clé, un étudiant ne voit et ne pilote que ses agents (avant : tous ceux de la même IP). Plafond total `MCP_MAX_BOTS` = 40 par cluster : à relever si une classe entière vise le même cluster avec 2-3 agents chacun.
1. Déployer CETTE version avant l'arrivée des étudiants : un ancien pod ne comprend pas les lots Pub/Sub des nouveaux (les rollouts suivants, même version, ne sont pas concernés).
2. `docker pull bitnami/redis:latest` et `bitnami/redis-sentinel:latest` : Bitnami ne publie plus que `latest` en gratuit.
3. Sur une vraie Kapsule : Ingress + Let's Encrypt, perte brutale d'un nœud (scénario 5) et `kubectl top` pour le HPA — non testés cette nuit.
4. À l'oreille et à la main : sons, manette, ressenti de conduite, qualité basse sur un portable sans GPU.
5. Pendant une coupure Redis, deux joueurs sur des pods différents se voient figés jusqu'au retour de Redis (normal : le Pub/Sub passe par Redis).

## Points ouverts techniques
- `scripts/playtest/mcp.mjs` stabilisé (16/16) : le test visait une chasse presque finie ; vrai bug corrigé au passage (un `despawn_agent` pendant le tick du leader ressuscitait l'agent). Non reproduit : « course jamais clôturée » (vu une fois, Redis partagé avec un autre serveur).
- `npm run smoke` : étape carjacking fiabilisée (10/10) ; trouvé au passage des voitures de circulation qui tombaient sous le monde : cause trouvée (apparition à y=0,8 en dur sous les routes de colline) et corrigée, plus murs au bord du terrain ; 99 chutes en 2 min → 0 en 5 min (`scripts/playtest/chutes.mjs`). Étape 1 « le perso ne marche pas » vue 2 fois sur 20, non reproduite en 90 essais : le smoke joint désormais un diagnostic complet si elle revient.

- Classement global : seulement les joueurs actifs depuis 24 h (`LEADERBOARD_ACTIVE_HOURS`) ; les entrées de test de la nuit disparaîtront d'elles-mêmes.

- Playtest du 19/11 midi : voiture de mission orientée vers la route, voitures qui se noient en mer, radar des kubes à 140 m. Puis voiture libre garée à ~15 m du départ et de chaque réapparition. Reste : monde vide hors de la ville.

## Frictions restantes (playtest « débutant », 19/11, `scripts/playtest/debutant.mjs`)
Premier pas jouable : ~4,4 s depuis le chargement de la page (titre 0,5 s, portraits 1,6 s, chargement 1,6 s). Corrigés : prompt « F : Monter » affiché à 4 m alors que F marche à 3 m ; GPS de mission effacé à chaque image par le module social ; aucun premier objectif (maintenant : encadré + GPS vers le marqueur jaune) ; pseudo non pris en compte avant rechargement ; astuces posées sur le perso (déplacées en haut) et affichées pendant K.O./Arrêté ; pas d'astuce sur les étoiles.
Corrigés ensuite (19/11) : marqueur Garage masqué tant qu'un marqueur de mission est à moins de 10 m, et invite « E » coupée pendant le dialogue ; voiture de mission orientée vers le premier point de l'itinéraire ; Chasse aux kubes (bandeau, rayons, GPS) masquée les 3 premières minutes d'un nouveau joueur (localStorage `kubecity.firstplay.v1`, côté client) ; écrans Arrêté/K.O. avec montant et délai ; lettres de déplacement selon la disposition (`navigator.keyboard.getLayoutMap`, repli par langue ; contrôles déjà en codes physiques KeyW/A/S/D) ; Entrée dans le pseudo lance avec le 1er perso, bandeau « Cliquez dans le jeu » limité à 4 s et fermé au clic ; astuces Tab/P/Alt/K liées au contexte (police ou blessure, loin du départ, mission faite, en voiture) avec repli tardif.
Restent :
- Classement de session : aucune date d'activité par ligne (`pn:ss:*` sans horodatage), donc pas de filtrage côté affichage sans toucher au serveur ; les entrées expirent seules (TTL de session) ; rien effacé dans Redis.
- Garage inaccessible par le marqueur tant que la mission 1 attend à côté (il revient après acceptation).
- Non vérifié sur un vrai clavier QWERTY/AZERTY physique (seulement la logique et le build).
