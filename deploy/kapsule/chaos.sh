#!/usr/bin/env bash
# Scénarios de chaos pour Kube City. À lancer PENDANT que la sonde tourne dans un autre terminal :
#   node scripts/sonde.mjs https://jeu.mon-groupe.fr
# Usage : ./chaos.sh <numéro|liste>     (ex. ./chaos.sh 1   ou   ./chaos.sh list)
# Variables : NS=kube-city  REL=jeu  REDIS_REL=redis  REDIS_SECRET=redis-auth  MASTER_NAME=mymaster
set -euo pipefail
NS=${NS:-kube-city}; REL=${REL:-jeu}; REDIS_REL=${REDIS_REL:-redis}
REDIS_SECRET=${REDIS_SECRET:-redis-auth}; MASTER_NAME=${MASTER_NAME:-mymaster}
GAME_SEL="app.kubernetes.io/instance=$REL,app.kubernetes.io/component=game"
k() { kubectl -n "$NS" "$@"; }
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
look() { printf '\033[33mÀ observer : %s\033[0m\n' "$*"; }
pods() { k get pods -l "$GAME_SEL" -o wide; }

# Pod Redis qui est maître d'après Sentinel (le nom de pod, ex. redis-node-1)
redis_master() {
  local pw addr h
  pw=$(k get secret "$REDIS_SECRET" -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d)
  addr=$(k exec "${REDIS_REL}-node-0" -c sentinel -- env REDISCLI_AUTH="$pw" \
    redis-cli -p 26379 sentinel get-master-addr-by-name "$MASTER_NAME" | head -1 | tr -d '\r')
  [ -n "$addr" ] || { echo "Sentinel ne répond pas" >&2; return 1; }
  if [[ "$addr" =~ ^[0-9.]+$ ]]; then   # adresse IP : on retrouve le pod
    k get pods -l app.kubernetes.io/name=redis -o jsonpath='{range .items[*]}{.metadata.name} {.status.podIP}{"\n"}{end}' | awk -v ip="$addr" '$2==ip{print $1}'
  else
    h=${addr%%.*}; echo "$h"
  fi
}

# Nœud qui porte le plus de pods de jeu (le plus gênant à perdre)
busiest_node() { k get pods -l "$GAME_SEL" -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' | sort | uniq -c | sort -rn | awk 'NR==1{print $2}'; }

s1() { say "1. Tuer un pod de jeu"
  look "reconnexion automatique des joueurs de ce pod en moins de 2 s ; sonde : 0 échec HTTP, 1 reconnexion WS ; le pod revient seul"
  local p; p=$(k get pods -l "$GAME_SEL" -o name | shuf -n1 2>/dev/null || k get pods -l "$GAME_SEL" -o name | head -1)
  echo "Cible : $p"; k delete "$p" --grace-period=0 --force; sleep 3; pods; }

s2() { say "2. Vider un nœud (kubectl drain)"
  local n; n=$(busiest_node); echo "Cible : $n"
  look "le PDB laisse partir les pods UN par un (jamais moins de 2 pods de jeu prêts) ; 0 échec HTTP ; si le nœud porte un Redis, Sentinel bascule"
  look "avec l'anti-affinité Redis « hard », le Redis évincé reste Pending tant que le nœud est coupé : normal, 2 Redis sur 3 suffisent"
  kubectl drain "$n" --ignore-daemonsets --delete-emptydir-data --timeout=180s || true
  pods; echo; echo "Pour remettre le nœud : kubectl uncordon $n"; }

s3() { say "3. Mise à jour progressive (rollout restart)"
  look "maxUnavailable 0 : toujours 3 pods prêts ; joueurs déplacés en douceur (DRAIN_DELAY_MS), 0 échec HTTP ; quelques reconnexions WS sont normales"
  k rollout restart deploy/"$REL"; k rollout status deploy/"$REL" --timeout=300s; pods; }

s4() { say "4. Tuer le maître Redis (Sentinel)"
  local m; m=$(redis_master); echo "Maître actuel : $m"
  look "Sentinel promeut un réplica en ~2 à 5 s ; les pods de jeu se reconnectent seuls ; 0 coupure HTTP, WS ouverte (état figé 2-5 s au pire)"
  k delete pod "$m" --grace-period=0 --force; sleep 8
  echo "Nouveau maître : $(redis_master)"; k get pods -l app.kubernetes.io/name=redis -o wide; }

s5() { say "5. Perdre un nœud : scale à 0 de son pool (ou arrêt brutal)"
  local n; n=$(busiest_node); echo "Nœud visé : $n (cordon + suppression brutale des pods dessus)"
  look "pods de jeu et Redis du nœud perdus d'un coup ; les 2 autres nœuds servent ; sonde : coupure < 10 s sur les WS concernées, HTTP quasi parfait"
  look "ensuite les pods évincés se replanifient (Redis en Pending si anti-affinité hard)"
  kubectl cordon "$n"
  k get pods --field-selector "spec.nodeName=$n" -o name \
    -l 'app.kubernetes.io/name in (kube-city,redis)' | xargs -r kubectl -n "$NS" delete --grace-period=0 --force
  sleep 5; pods
  echo; echo "Version « pool » (plus réaliste) : scw k8s pool update <pool-id> size=2 ; rétablir : size=3"
  echo "Remettre le nœud : kubectl uncordon $n"; }

case "${1:-list}" in
  1) s1;; 2) s2;; 3) s3;; 4) s4;; 5) s5;;
  list|*) cat <<USAGE
Scénarios (lancer la sonde avant : node scripts/sonde.mjs https://votre-hote) :
  1  tuer un pod de jeu          3  mise à jour progressive (rollout restart)
  2  vider un nœud (drain)       4  tuer le maître Redis (via Sentinel)
  5  perdre un nœud d'un coup
Exemple : NS=kube-city REL=jeu ./chaos.sh 4
USAGE
  ;;
esac
