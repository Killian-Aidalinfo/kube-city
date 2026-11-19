// Exécuteur de missions data-driven : enchaîne des objectifs (aller à, suivre, semer, mettre K.O., photographier…).
// Il ne touche ni au DOM ni à Three.js : tout passe par l'objet `env` fourni par gameplay/index.js (testable sous Node).
import { createRace, dist2d, pathLength, pointAlong } from './activities.js';

/**
 * env attendu : pos(), inVehicle(), wanted(), setWanted(n), place(ref) → {x,z}, say(speaker, text, dur), notify(text, kind),
 * spawnVehicle(spec) → { pos() }, switchTo(id), currentChar(), koCount(), photoCount(), photoNear(pos, r), route(a, b), vehicleDamage()
 */

const resolveRef = (env, ref) => (ref && typeof ref === 'object' && 'x' in ref ? { x: ref.x, z: ref.z } : env.place(ref));

// Chaque type d'objectif : start(step, st, env), update(step, st, env, dt) → 'done' | 'fail:raison' | undefined, target(st) → {x,z} | null
export const STEP_TYPES = {
  goto: {
    start(step, st, env) { st.pos = resolveRef(env, step.to); },
    update(step, st, env) {
      if (step.vehicle && !env.inVehicle()) return undefined;
      return dist2d(env.pos(), st.pos) <= (step.radius ?? 7) ? 'done' : undefined;
    },
    target: (st) => st.pos,
  },
  enterVehicle: {
    start(step, st, env) { if (step.spawn) st.vehicle = env.spawnVehicle({ ...step.spawn, at: resolveRef(env, step.spawn.at) }); },
    update(step, st, env) { return env.inVehicle() ? 'done' : undefined; },
    target: (st) => st.vehicle?.pos?.() ?? null,
  },
  follow: {
    start(step, st, env) {
      const a = resolveRef(env, step.from), b = resolveRef(env, step.to);
      const r = env.route?.(a, b);
      st.path = Array.isArray(r) && r.length > 1 ? r : [a, b];
      st.len = pathLength(st.path); st.d = 0; st.far = 0; st.pos = { ...a };
    },
    update(step, st, env, dt) {
      const gap = dist2d(env.pos(), st.pos);
      // la cible attend le joueur s'il est trop loin
      if (gap < (step.maxGap ?? 35)) { st.d = Math.min(st.len, st.d + (step.speed ?? 6) * dt); st.far = 0; } else st.far += dt;
      st.pos = pointAlong(st.path, st.d);
      if (st.far > (step.patience ?? 12)) return 'fail:Vous avez perdu la cible de vue.';
      if (st.d >= st.len && gap < 20) return 'done';
      return undefined;
    },
    target: (st) => st.pos,
  },
  evade: {
    start(step, st, env) { st.seen = false; st.t = 0; env.setWanted(step.level ?? 2); },
    update(step, st, env, dt) {
      st.t += dt;
      if (env.wanted() > 0) st.seen = true;
      if (st.seen ? env.wanted() === 0 : st.t > 1) return 'done';
      // sécurité si la police ne fonctionne pas : on valide après un délai
      if (st.t > (step.maxTime ?? 240)) return 'done';
      return undefined;
    },
    target: () => null,
  },
  say: {
    start(step, st, env) { st.i = 0; st.t = 0; st.started = false; },
    update(step, st, env, dt) {
      const lines = step.lines;
      if (!st.started || st.t <= 0) {
        if (st.i >= lines.length) return 'done';
        const l = lines[st.i++];
        env.say(l.speaker, l.text, l.dur ?? 4);
        st.started = true; st.t = l.dur ?? 4;
      }
      st.t -= dt;
      return undefined;
    },
    target: () => null,
  },
  wait: {
    start(step, st) { st.t = step.seconds ?? 3; },
    update(step, st, env, dt) { st.t -= dt; return st.t <= 0 ? 'done' : undefined; },
    target: () => null,
  },
  switch: {
    start(step, st, env) { st.asked = false; },
    update(step, st, env) {
      if (env.currentChar() === step.to) return 'done';
      if (!st.asked) { st.asked = true; env.switchTo(step.to); }
      return undefined;
    },
    target: () => null,
  },
  ko: {
    start(step, st, env) { st.base = env.koCount(); st.pos = step.at ? resolveRef(env, step.at) : null; },
    update(step, st, env) { return env.koCount() - st.base >= (step.count ?? 1) ? 'done' : undefined; },
    target: (st) => st.pos,
    progress: (step, st, env) => `${Math.min(step.count ?? 1, env.koCount() - st.base)}/${step.count ?? 1}`,
  },
  photo: {
    start(step, st, env) { st.base = env.photoCount(); st.pos = step.at ? resolveRef(env, step.at) : null; },
    update(step, st, env) {
      if (env.photoCount() <= st.base) return undefined;
      // une photo prise trop loin du sujet ne compte pas : on réarme
      if (st.pos && !env.photoNear(st.pos, step.radius ?? 60)) { st.base = env.photoCount(); env.notify('Rapprochez-vous du sujet pour la photo.', 'warning'); return undefined; }
      return 'done';
    },
    target: (st) => st.pos,
  },
  // Poursuite : la cible (un singe au volant) fuit le long d'un trajet aller-retour ; il faut la rattraper en véhicule.
  chase: {
    start(step, st, env) {
      const a = resolveRef(env, step.from), b = resolveRef(env, step.to);
      const r = env.route?.(a, b);
      st.path = Array.isArray(r) && r.length > 1 ? r : [a, b];
      st.len = pathLength(st.path); st.d = 0; st.dir = 1; st.pos = { ...a };
      if (step.spawn) st.vehicle = env.spawnVehicle({ ...step.spawn, at: a });
    },
    update(step, st, env, dt) {
      st.d += st.dir * (step.speed ?? 9) * dt;
      if (st.d >= st.len) { st.d = st.len; st.dir = -1; } else if (st.d <= 0) { st.d = 0; st.dir = 1; }
      const prev = st.pos;
      st.pos = pointAlong(st.path, st.d);
      env.moveVehicle?.(st.vehicle, st.pos, Math.atan2(st.pos.x - prev.x, st.pos.z - prev.z));
      return env.inVehicle() && dist2d(env.pos(), st.pos) <= (step.radius ?? 9) ? 'done' : undefined;
    },
    target: (st) => st.pos,
  },
  // Adresses mouvantes : le point d'arrivée change dès qu'on s'en approche (le DNS, c'est toujours le DNS).
  reroute: {
    start(step, st, env) { st.stops = step.stops.map((s) => resolveRef(env, s)); st.i = 0; },
    update(step, st, env) {
      if (!env.inVehicle()) return undefined;
      const d = dist2d(env.pos(), st.stops[st.i]);
      const last = st.i >= st.stops.length - 1;
      if (last) return d <= (step.radius ?? 10) ? 'done' : undefined;
      if (d <= (step.switchDist ?? 60)) {
        const l = step.lines?.[st.i];
        if (l) env.say(l.speaker, l.text, l.dur ?? 4);
        env.notify('Nouvelle adresse reçue !', 'warning', 2.5);
        st.i++;
      }
      return undefined;
    },
    target: (st) => st.stops?.[st.i] ?? null,
    progress: (step, st) => `adresse ${st.i + 1}/${st.stops.length}`,
  },
  race: {
    start(step, st, env) {
      const cps = step.checkpoints.map((c) => resolveRef(env, c));
      st.race = createRace(cps, (step.rivals ?? [{ name: 'Rival', speed: 22 }]), env.pos());
      st.cps = cps; st.fresh = true;
    },
    update(step, st, env, dt) {
      if (!env.inVehicle()) return undefined;
      const r = st.race.update(dt, env.pos());
      if (r === 'checkpoint') env.notify(`Point de passage ${st.race.index}/${st.cps.length}`, 'info', 1.5);
      if (r === 'finish') {
        st.place = st.race.place;
        if (step.mustWin && st.place > 1) return `fail:Vous avez fini ${st.place}e : le Cluster exige la première place.`;
        return 'done';
      }
      return undefined;
    },
    target: (st) => st.cps?.[st.race.index] ?? null,
    progress: (step, st, env) => `Place ${st.race.rank(env.pos())}/${st.race.rivals.length + 1} · ${st.race.index}/${st.cps.length}`,
  },
};

/**
 * Crée l'exécuteur d'une mission ou d'une activité.
 * @param {{id:string,title:string,steps:object[],timeLimit?:number}} def
 */
export function createRunner(def, env) {
  const runner = {
    def, index: 0, status: 'running', failReason: '', elapsed: 0, stepTime: 0, st: {}, result: {},
    get step() { return def.steps[runner.index]; },
    get text() {
      const s = runner.step; if (!s) return '';
      const p = STEP_TYPES[s.type]?.progress?.(s, runner.st, env);
      const base = p ? `${s.text} (${p})` : s.text || '';
      // objectif en voiture : on explique pourquoi la destination ne valide pas à pied
      return s.type === 'goto' && s.vehicle && !env.inVehicle() ? `Prenez un véhicule. ${base}` : base;
    },
    /** Position de l'objectif courant (pour le GPS et la minimap) ou null. */
    get target() { const s = runner.step; return s ? STEP_TYPES[s.type]?.target(runner.st) ?? null : null; },
    /** Secondes restantes si l'objectif est chronométré. */
    get timeLeft() { const s = runner.step; return s?.timeLimit ? Math.max(0, s.timeLimit - runner.stepTime) : null; },
    /** Rejoue l'objectif courant depuis le début (point de passage). */
    restartStep() { runner.status = 'running'; runner.failReason = ''; beginStep(); },
    update(dt) {
      if (runner.status !== 'running') return runner.status;
      runner.elapsed += dt; runner.stepTime += dt;
      const s = runner.step;
      if (!s) { runner.status = 'passed'; return runner.status; }
      if (s.timeLimit && runner.stepTime > s.timeLimit) return fail(s.failText || 'Temps écoulé !');
      if (s.failOnDamage && env.vehicleDamage?.() > s.failOnDamage) return fail('Le véhicule est trop abîmé !');
      const r = STEP_TYPES[s.type]?.update(s, runner.st, env, dt);
      if (r === 'done') {
        if (s.type === 'race') runner.result.place = runner.st.place;
        runner.index++;
        if (runner.index >= def.steps.length) runner.status = 'passed'; else beginStep();
      } else if (r?.startsWith?.('fail')) return fail(r.slice(5) || 'Mission échouée.');
      return runner.status;
    },
  };
  function fail(reason) { runner.status = 'failed'; runner.failReason = reason; return runner.status; }
  function beginStep() {
    const s = runner.step; runner.stepTime = 0; runner.st = {};
    if (!s) return;
    if (!STEP_TYPES[s.type]) throw new Error(`Type d'objectif inconnu : ${s.type}`);
    // dialogues d'accompagnement (sans bloquer)
    for (const l of s.say || []) env.say(l.speaker, l.text, l.dur ?? 4);
    STEP_TYPES[s.type].start(s, runner.st, env);
    env.onStep?.(runner);
  }
  beginStep();
  return runner;
}
