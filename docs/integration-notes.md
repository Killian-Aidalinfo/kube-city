# Notes d'intégration (rapports des développeurs, pour la revue Opus)

## PNJ + POLICE + COMBAT (livré, build + 47 tests OK ; non testé avec les vrais monde/véhicules)
- game.police : level, heat, searchZone {center,radius}, searching, searchTimer, searchTotal, units, footUnits, helicopter, arrestProgress, setLevel, clear, report, notifyRepaint. Seuils chaleur 8/24/50/90/150.
- game.combat : weapons, defs, current/weapon, ammo, cooldowns, aiming, wheelOpen, dodging, setWeapon, hit, damagePlayer, heal, giveArmor, targets. Esquive = C. combat remplace game.player.applyDamage. Roue + réticule DOM minimaux dans combat/wheel.js (l'UI peut les remplacer).
- À brancher :
  - core/loop.js doit multiplier dt par game.time.scale (combat le met à 0,2 pendant la roue).
  - Véhicules : steer>0 = droite (STEER_SIGN dans npc/driver.js), spawn(type,{x,y,z},yaw,{owner}) avant +Z, veh.teleport(p,yaw), veh.honk(dur), veh.siren, veh.owner/speed(km/h)/type/health/destroyed.
  - Monde : roads/sidewalks lus sous plusieurs formes ; feux : stateFor(dx,dz) | canGo | state+axis | state{ns,ew} + position ; route → points {x,z}.
  - Joueur : playAction(clip)/playAnimation, setAiming(bool), dash(dir,dist,dur), knockOut(cause) ; sinon événements combat:attack {clip} ; geler la caméra pendant combat:wheel {open}.
  - Gameplay : wanted:busted → perte d'argent + respawn commissariat ; garage → émettre vehicle:repainted ou police.notifyRepaint().
  - Erreur console « Illegal invocation » sur s.onopen dans le module réseau.

## RÉSEAU + SERVEUR (livré, build + 32 tests OK, vérifié en docker compose avec 2 clients)
- Protocole v2 dans src/protocol.js ; src/server.js réécrit ; profils Redis pn:profile:<id> (90 j, 48 Ko).
- game.net : players, status, sendChat, sendEmote, sendEvent, saveProfile, loadProfile, setName, send. net:status { connected, pod, version, reconnects, ping, leader, sync, previousPod }.
- Événements en plus (à documenter dans core/events.js) : net:chat, net:emote, net:event, net:profile, net:players, net:message.
- Agents IA : src/city.js = grille de repli + lieux. TODO : remplacer par client/src/world/citygen.js (même interface exportée).
- window.__quickStart manquant à l'époque (l'UI doit le fournir).
- Erreur console « e.traverse is not a function » côté combat avec un faux object3d.
- public/ (v1 2D) n'est plus servi : à supprimer ; README à mettre à jour.
- Variante Sentinel : seulement validée par docker compose config -q, pas relancée.

## JOUEUR + VÉHICULES (livré, build + 75 tests OK, vérifié headless sur le vrai monde)
- game.player en plus : position (pieds), heading, speed2d, aiming, aimAnim, playAnim(key,{once,lock,fade,timeScale}), setPose, setCollidable, revive, ragdoll(impulse,dmg), camera.aimRay/yaw/setYaw, addPromptProvider(fn → {id,key,text,priority,onTrigger}), événement player:prompt.
  → NB : le combat attend playAction/setAiming/dash/knockOut : adapter (playAnim existe, setAiming à mapper sur aiming).
- player:ko émis par le JOUEUR à santé 0 (le combat ne doit pas le réémettre ; combat remplace aussi applyDamage : vérifier qu'il n'y a pas de double émission).
- Véhicules : types indexés par id de modèle + alias de catégorie ; setControls steer +1 = droite (cohérent avec PNJ) ; spawn(type,pos,rot,{owner,color,driver}) ; enter(npc,v,seat) instantané ; registerCollider ; owner 'remote' → setRemoteState({x,y,z,rotation,steer,speed}) (à utiliser par net/remote.js).
- Audio : Vehicle.rpm (0..1), skid, speed (km/h), throttle, braking, horn ; événement vehicle:horn.
- Carjacking : vehicle:driverEjected {vehicle,driver,position} + crime carjack ; driver.eject / onEjected si présents (les PNJ doivent les fournir).
- player:respawn téléporte vers world.places hopital / commissariat.
- Monde optionnel : waterLevelAt(x,z) ou isWater+waterLevel ; weather.wetness/rain.
- Erreurs vues : « st is not defined » dans play() de l'UI ; shader « vFogDepth redéfini » côté monde.

## MONDE (livré, build + 85 tests OK, captures vérifiées)
- citygen.js pur (generateCity, RoadGraph) → à brancher dans src/city.js côté serveur (agents IA) à la place de la grille de repli.
- game.world en plus : query, setTime, hour, isNight, ramps, pier, buildings, lamps ; water {level,isWater,depth,sensor} ; weather {set,cloud,rain,wetness,auto} ; trafficCycle 24 s, tl.state('ns'|'ew') → 'green'|'yellow'|'red', forceGreen(tl,axis) (capacité de Jade) ; roads.lanePoints(edge,dir,lane) conduite à droite ; places sans accents (hopital, planque_ines…) ; ~100 véhicules garés avec hint de type ; ~380 points piétons ; 5 rampes.
- Lacet rotation = atan2(dx,dz) (avant +Z).
- Perf : ~335 draw calls dans une vue de rue (monde ~115) > 300 de la spec : à optimiser (instancing piétons/véhicules).
- Hook caméra avant ordre 95 pour la visibilité des chunks. Arbres et lampadaires sans collision.
- Le joueur signale une erreur shader « vFogDepth redéfini » côté monde.

## INTERFACE + GAMEPLAY + AUDIO (livré, build + tests OK, vérifié dans Chrome ; son non vérifié)
- Le jeu démarre sur l'écran titre ; window.__quickStart(id?) (promesse) saute les menus → le smoke test doit l'utiliser.
- game.ui : setWaypoint(pos,{auto}), openMap, openPhone, pause, resume, quickStart ; panneau HA repliable (F2).
- Gameplay : 9 missions + casse du datacenter ; capacités sur G ; time.scale 0,5 pendant Focus (le combat met 0,2 pendant la roue : conflit à arbitrer, et core/loop.js doit appliquer time.scale) ; world.hackUntil, police.jammedUntil/jam(), vehicle.damageScale, player.setOutfit.
- Lit : police.searchZone, police.units, world.roads {nodes,edges}, world.places, net.players, combat.currentWeapon (le combat expose current/weapon : à aligner).
- Écoute npc:ko (non déclaré) : le combat doit l'émettre. Événements à déclarer : outfit:changed, ability:used, ui:prompt, ui:photo, ui:shop, ui:sound.
- Touche R radio gérée par AUDIO : vérifier que VÉHICULES ne la gère pas aussi.
- Garage : vehicle.paint/setColor/applyUpgrades si présents (sinon teinte matériaux body/paint) ; doit aussi notifier la police (vehicle:repainted / police.notifyRepaint).
- Erreur vue par joueur+véhicules : « st is not defined » dans play() de l'UI (peut-être corrigée depuis).

## STATUT APRÈS INTÉGRATION (revue Opus, 2026-11-18)
- Temps : `game.time.setScale(source, k)`, facteur = plus fort ralenti (roue 0,2 > Focus 0,5), appliqué par core/loop.js ; abonnés `{ real: true }` = entrées, caméra, UI, audio, réseau, rendu. Les `sdt` locaux (PNJ, police, combat) sont neutralisés. Durée de Focus en temps réel.
- Combat ↔ joueur : `playAnim(clip, {once, lock})`, `player.knockOut` public (seul émetteur de player:ko), `player.dash`, `setAiming` (compat), `aimAnim` par arme, `combat.currentWeapon`, `npc:ko` émis par le combat, garde contre les faux object3d (e.traverse).
- Caméra figée pendant la roue. Garage → `vehicle:repainted` → police.notifyRepaint (plus de double baisse).
- Touche R : seul l'audio la gère (vérifié). Klaxon PNJ unifié en `vehicle:horn { npc: true }`. net écoute `outfit:changed` (au lieu de character:outfit).
- net/remote.js : véhicules distants = vrais véhicules `owner: 'remote'` + `setRemoteState` (y clampé au sol pour les agents IA) ; vitesse envoyée = châssis.
- Circulation : conducteurs PNJ exposés en `veh.driver` avec `onEjected` (carjacking → fuite). Feux : lecture de `tl.state(axis)` (les PNJ grillaient les feux). Panne de réseau de Jade branchée sur `world.forceGreen`.
- src/city.js : lieux, quartiers et itinéraires tirés de citygen.js (copié dans l'image Docker).
- Erreurs console : « st is not defined » (radio) corrigé ; PCFSoftShadowMap → PCFShadowMap ; « vFogDepth » et « Illegal invocation » non reproduits (renderer.compile dans le smoke).
- Perf : LOD véhicules (ombres, roues, feux selon la distance caméra) + ombres des piétons < 30 m + piétons masqués > 120 m : passe d'ombre 107-131 → 19-43 appels ; total en rue 134-170 (avant 235-335).
- public/ (client 2D v1) supprimé.
