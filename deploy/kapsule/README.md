# Déployer Kube City en haute disponibilité sur Scaleway Kapsule

Pas à pas pour un cluster **dans une seule zone** (fr-par-1 ou fr-par-2), **3 nœuds**.
Fichiers : `values-redis.yaml`, `values-kube-city.yaml`, `chaos.sh` (épreuves), barème en fin de page.
Les valeurs Redis ont été vérifiées avec `helm show values` (chart Bitnami `redis` 28.3.12) et l'ensemble a été
rejoué sur un cluster kind à 3 nœuds (Redis + Sentinel + 3 pods de jeu, kill du maître Redis, kill d'un pod, rollout, drain).

Outils : `scw`, `kubectl`, `helm`, `node` 22+ (pour la sonde).

## 1. Créer le cluster

```bash
scw init                                   # une seule fois : clé d'API, projet, zone par défaut
scw k8s version list                       # prenez la dernière version listée
scw k8s cluster create name=kube-city version=<derniere-version> cni=cilium \
  region=fr-par pools.0.name=jeu pools.0.node-type=DEV1-M pools.0.size=3 \
  pools.0.zone=fr-par-1                    # une seule zone. PLAY2-SMALL marche aussi.
scw k8s cluster list                       # attendez l'état « ready » (quelques minutes)
scw k8s kubeconfig install <cluster-id>    # configure kubectl
kubectl get nodes                          # 3 nœuds Ready
```

Pas d'autoscaling du pool : 3 nœuds fixes. (Si vous activez l'autoscaling, gardez `min-size=3`.)

## 2. Ingress (nginx)

```bash
helm upgrade --install ingress-nginx ingress-nginx --repo https://kubernetes.github.io/ingress-nginx \
  -n ingress-nginx --create-namespace --set controller.replicaCount=3 \
  --set controller.service.externalTrafficPolicy=Local
kubectl -n ingress-nginx get svc ingress-nginx-controller -w   # attendez l'EXTERNAL-IP
```

Créez ensuite un enregistrement DNS `A jeu.mon-groupe.fr -> EXTERNAL-IP`.
Traefik convient aussi : mettez `ingress.className: traefik` dans `values-kube-city.yaml`.
3 réplicas de contrôleur : l'ingress lui-même ne doit pas être un point unique. Les WebSocket passent sans réglage.

## 3. HTTPS avec Let's Encrypt (facultatif)

```bash
helm upgrade --install cert-manager cert-manager --repo https://charts.jetstack.io \
  -n cert-manager --create-namespace --set crds.enabled=true
kubectl apply -f - <<'YAML'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: vous@mon-groupe.fr
    privateKeySecretRef: { name: letsencrypt-key }
    solvers: [{ http01: { ingress: { ingressClassName: nginx } } }]
YAML
```

Puis dans `values-kube-city.yaml` : `tls: true` et `annotations: { cert-manager.io/cluster-issuer: letsencrypt }`.

## 4. Redis avec Sentinel (chart Bitnami)

```bash
kubectl create namespace kube-city
kubectl -n kube-city create secret generic redis-auth --from-literal=REDIS_PASSWORD="$(openssl rand -hex 16)"
helm upgrade --install redis oci://registry-1.docker.io/bitnamicharts/redis \
  -n kube-city -f deploy/kapsule/values-redis.yaml --version 28.3.12
kubectl -n kube-city rollout status sts/redis-node       # 3 pods, chacun 2/2 (Redis + Sentinel)
```

> Version du chart épinglée (28.3.12, testée sur kind). Les images Bitnami gratuites ne sont publiées qu'en `latest` :
> faites un `docker pull bitnami/redis:latest` la veille pour vérifier qu'elles se tirent toujours.

Ce que fait `values-redis.yaml` : 3 pods Redis (1 maître + 2 réplicas) avec un Sentinel dans chacun ;
`downAfterMilliseconds: 2000` (maître muet 2 s = en panne), `failoverTimeout: 10000`, `quorum: 2` ;
anti-affinité `hard` (1 Redis par nœud) ; PDB `maxUnavailable: 1` ; AOF toutes les secondes.

**Pourquoi RWO (un disque par pod) et pas RWX ?**
Chaque Redis garde SA copie des données : le maître écrit, les réplicas copient. Un volume RWO (`scw-bssd`, bloc Scaleway) est
rapide, fiable, et chaque pod a le sien (via `volumeClaimTemplates`). Un volume RWX partagé (NFS, CephFS) serait lent,
ferait écrire plusieurs Redis dans les mêmes fichiers (corruption) et recréerait un point unique de panne : si ce disque
tombe, les 3 copies tombent avec lui. La réplication, c'est Redis qui la fait, pas le stockage.
Limite : un disque RWO est lié à la zone, d'où une seule zone ici (pas de Redis multi-zone avec scw-bssd).

## 5. Installer Kube City

```bash
# modifiez ingress.host dans values-kube-city.yaml, puis :
helm upgrade --install jeu ./chart/kube-city -n kube-city -f deploy/kapsule/values-kube-city.yaml
kubectl -n kube-city get pods -o wide        # 3 pods de jeu sur 3 nœuds différents
curl https://jeu.mon-groupe.fr/api/info
```

Les clés `redis.sentinel.*` à connaître : `hosts` (les 3 Sentinel, `redis-node-N.redis-headless.<namespace>.svc.cluster.local:26379`),
`masterName` (`mymaster`, comme `sentinel.masterSet`), `passwordSecret` (Secret `redis-auth`, clé `REDIS_PASSWORD`).
Gardez `redis.enabled: false`, sinon le chart crée en plus un Redis simple inutile.
Si vous changez le namespace, changez-le aussi dans `hosts`.
L'image vient de `ghcr.io/killian-aidalinfo/kube-city` (`image.tag` pour une autre version).

## 6. Mises à jour progressives : compatibilité des messages

Pendant une mise à jour, des pods anciens et nouveaux se parlent via Redis Pub/Sub.
Les nouveaux pods publient des **lots** d'états (`k: "pb"`) ; ils acceptent toujours l'**ancien format** (états unitaires
`k: "p"`, vérifié dans `src/server.js`, test `test/pubsub-compat.test.js`). L'inverse n'est pas possible : un pod très ancien
ignore les lots. Conséquence : pendant la mise à jour, un joueur sur un pod ancien voit un peu en retard les joueurs des
nouveaux pods ; tout est complet dès la fin du déploiement. Aucune coupure.

## 7. Épreuves de chaos

Terminal A : `node scripts/sonde.mjs https://jeu.mon-groupe.fr` (laisser tourner, Ctrl+C = bilan).
Terminal B : `NS=kube-city REL=jeu ./deploy/kapsule/chaos.sh <n>` (`./chaos.sh list` pour la liste).

| n | Épreuve | À observer |
|---|---|---|
| 1 | Tuer un pod de jeu | Les joueurs du pod se reconnectent en < 2 s, 0 échec HTTP, le pod revient seul |
| 2 | Vider un nœud (`drain`) | Le PDB fait partir les pods un par un, jamais moins de 2 prêts ; si le nœud portait un Redis, il reste `Pending` (normal) |
| 3 | `rollout restart` | Toujours 3 pods prêts, 0 échec HTTP, quelques reconnexions WS |
| 4 | Tuer le maître Redis | Sentinel élit un nouveau maître en 2 à 5 s, le jeu se reconnecte seul |
| 5 | Perdre un nœud d'un coup | Coupure WS < 10 s, HTTP quasi parfait, replanification sur les 2 autres nœuds |

Après les épreuves 2 et 5 : `kubectl uncordon <nœud>`. Le script a un vrai arrêt de pool en option : `scw k8s pool update <pool-id> size=2`.
Résultat de la sonde en local : un `kubectl port-forward` meurt avec le pod visé et fausse la mesure : mesurez toujours via l'Ingress.

## Barème de notation HA (enseignant, sur 20)

Mesures : la sonde pendant les épreuves 1 à 5 (une minute chacune, pas de réutilisation d'un `port-forward`), plus `kubectl`.

| Critère | Points | Comment le mesurer |
|---|---|---|
| Disponibilité HTTP de la sonde sur toutes les épreuves | 4 | ≥ 99,9 % : 4 ; ≥ 99 % : 3 ; ≥ 97 % : 2 ; ≥ 90 % : 1 ; sinon 0 |
| Coupure maximale du jeu (WebSocket), plus longue des épreuves | 3 | ≤ 3 s : 3 ; ≤ 10 s : 2 ; ≤ 30 s : 1 ; sinon 0 |
| Redis Sentinel opérationnel | 4 | 3 pods 2/2 sur 3 nœuds (1) ; bascule observée épreuve 4 (2) ; reconnexion du jeu sans redémarrage (1) |
| PodDisruptionBudget jeu | 2 | `kubectl get pdb` : `minAvailable: 2` et drain réussi sans passer sous 2 pods prêts (2) ; PDB présent seulement (1) |
| Répartition des pods (anti-affinité / topologySpread) | 2 | 3 pods de jeu sur 3 nœuds différents (1) + 3 Redis sur 3 nœuds différents (1) |
| Probes | 2 | readiness + liveness + startup présentes et cohérentes (`kubectl describe`) (1) ; 0 requête perdue pendant un rollout (1) |
| Mise à jour sans coupure | 1 | `maxUnavailable: 0`, 3 pods prêts en permanence pendant l'épreuve 3 |
| Persistance Redis | 1 | PVC RWO `scw-bssd` par pod, explication RWO vs RWX correcte à l'oral |
| Sécurité de base | 1 | Mot de passe Redis dans un Secret, rien en clair dans les values rendus au groupe |

Total 20. Bonus oral possible : explication de l'ordre des événements d'une bascule Sentinel.
