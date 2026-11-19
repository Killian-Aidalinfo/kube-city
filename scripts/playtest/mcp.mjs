// Playtest MCP : un vrai client MCP (SDK) joue un scénario complet contre un serveur local lancé sur le port 8308
// (ou l'URL passée en argument) avec un joueur humain simulé en WebSocket. Nécessite Redis (REDIS_URL, défaut localhost:6380).
// Valide : outils, création d'agent, course d'un agent contre un humain, course proposée par l'agent, chat/emote reçus avec badge IA,
// chasse aux kubes dorés, classement, limites (agents par clé, anti-spam, agent d'autrui). Sortie : JSON, code 1 si un critère échoue.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';
import Redis from 'ioredis';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], R = {};
const check = (ok, msg) => { if (!ok) { fails.push(msg); console.error('ECHEC', msg); } return ok; };
const step = (m) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
let base = process.argv[2], server = null;
if (!base) {
  // une chasse planifiée par un autre serveur de test (délai de 10 min) ferait attendre : on avance la prochaine chasse
  const r = new Redis(process.env.REDIS_URL || 'redis://localhost:6380');
  await r.set('pn:hunt:next', String(Date.now() + 3000), 'EX', 3600); await r.quit();
  const port = process.env.PORT || 8308;
  server = spawn('node', ['src/server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(port), REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6380', RACE_LOBBY_MS: '12000', HUNT_EVERY_MS: '4000', HUNT_DURATION_MS: '120000', DRAIN_DELAY_MS: '100', MCP_MAX_BOTS_PER_KEY: '3' } });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* pas prêt */ } await sleep(250); }
}
const fakeIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`; // isole les compteurs Redis entre deux runs
const runKey = `etudiant-${Math.random().toString(16).slice(2, 8)}`; // un quota par exécution
const connect = async (ip = fakeIp, key = runKey) => {
  const c = new Client({ name: 'playtest', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { 'x-forwarded-for': ip, 'x-kube-key': key } } }));
  return c;
};
const call = async (c, name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const t = r.content?.[0]?.text ?? '';
  let data = t; try { data = JSON.parse(t); } catch { /* texte brut */ }
  return { err: !!r.isError, data };
};

// joueur humain simulé (WebSocket protocole v2)
function human(name, p) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const h = { ws, id: `joueur-${Math.random().toString(16).slice(2, 8)}`, chat: [], emotes: [], msgs: [], p, snaps: new Map() };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw); h.msgs.push(m);
    if (m.t === 'chat') h.chat.push(m.msg);
    if (m.t === 'emote') h.emotes.push(m);
    if (m.t === 'snap') for (const e of m.players) h.snaps.set(e.id, { ...(h.snaps.get(e.id) || {}), ...e });
  });
  const send = (o) => ws.send(JSON.stringify(o));
  h.send = send;
  h.ready = new Promise((r) => ws.on('open', () => { send({ t: 'hello', v: 2, id: h.id, name, ch: 'ines', p }); setTimeout(r, 500); }));
  h.timer = setInterval(() => { if (ws.readyState === 1) send({ t: 'state', p: h.p, r: 0, vel: [0, 0, 0], a: 'idle' }); }, 100);
  return h;
}
const waitFor = async (fn, ms, step = 400) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; };

try {
  const c = await connect();
  const tools = (await c.listTools()).tools.map((t) => t.name);
  R.tools = tools;
  for (const n of ['spawn_agent', 'look', 'drive_to', 'drive_to_xy', 'say', 'emote', 'propose_race', 'join_race', 'race_status', 'hunt_status', 'collect_kube', 'leaderboard', 'get_map', 'nearby_players', 'despawn_agent']) check(tools.includes(n), `outil manquant : ${n}`);

  const places = (await call(c, 'list_places')).data;
  check(Array.isArray(places) && places.length > 3, 'list_places vide');
  const map = (await call(c, 'get_map')).data;
  check(map.tailleM === 1200 && map.lieux?.length, 'get_map invalide');

  const a = (await call(c, 'spawn_agent', { name: 'Turbo', color: '#ff8800' })).data;
  check(a.agentId, 'spawn_agent sans agentId');
  const id = a.agentId;
  R.spawn = { id, x: a.x, z: a.z };

  // humain simulé, posé à côté de l'agent
  const H = human('Alice', [a.x + 5, 0, a.z + 5]);
  await H.ready;
  await waitFor(() => H.snaps.get(id)?.bot === 1 && H.snaps.get(id)?.vh, 6000); // champs rares : snapshot complet toutes les 2 s
  check(H.snaps.get(id)?.bot === 1, "l'humain ne voit pas l'agent comme IA (bot:1 dans le snapshot)");
  check(H.snaps.get(id)?.vh?.type, "l'agent n'a pas de véhicule dans le snapshot");
  const look = (await call(c, 'look', { agentId: id })).data;
  check(look.autour?.some((p) => p.name === 'Alice' && p.ia === false), "look ne voit pas le joueur humain");
  R.look = { autour: look.autour?.length, chasse: typeof look.chasse };

  step('chat + emote');
  // chat + emote
  check(!(await call(c, 'say', { agentId: id, message: 'Salut Alice, prête à perdre ?' })).err, 'say a échoué');
  check(await waitFor(() => H.chat.find((m) => m.bot && /\(IA\)$/.test(m.from) && /Alice/.test(m.text)), 3000, 200), 'le chat de l\'IA n\'arrive pas (bot:true, nom (IA))');
  check((await call(c, 'say', { agentId: id, message: 'spam' })).err, 'anti-spam du chat absent');
  check(!(await call(c, 'emote', { agentId: id, emote: 'bravo' })).err, 'emote a échoué');
  check(await waitFor(() => H.emotes.find((e) => e.id === id && e.e === 'bravo'), 3000, 200), "l'emote de l'IA n'arrive pas");

  step('course lancée par l');
  // course lancée par l'humain, l'agent la rejoint puis la gagne ou la termine
  H.send({ t: 'race_new', to: 'stade' });
  const race = await waitFor(() => H.msgs.find((m) => m.t === 'race' && m.race.creatorName === 'Alice')?.race, 4000, 200);
  check(race, "la course de l'humain n'est pas diffusée");
  if (race) {
    const j = await call(c, 'join_race', { agentId: id, raceId: race.id });
    check(!j.err, `join_race a échoué : ${JSON.stringify(j.data)}`);
    const rs = (await call(c, 'race_status', { raceId: race.id })).data;
    check(rs.classement?.some((x) => x.nom === 'Turbo'), 'race_status : Turbo absent des inscrits');
    const end = await waitFor(() => H.msgs.find((m) => m.t === 'race_end' && m.raceId === race.id), 170000, 1000);
    check(end, 'course jamais clôturée');
    const row = end?.rows?.find((r) => r.name === 'Turbo');
    check(row && row.ms != null, `Turbo n'a pas fini la course : ${JSON.stringify(end?.rows)}`);
    R.race1 = { vers: race.toLabel, turbo: row };
  }

  step('course proposée par ');
  // course proposée par l'agent, rejointe par l'humain (près du départ)
  await sleep(1500);
  const st = (await call(c, 'look', { agentId: id })).data.moi;
  H.p = [st.x, 0, st.z];
  await sleep(500);
  const pr = await call(c, 'propose_race', { agentId: id, to: 'port' });
  check(!pr.err, `propose_race a échoué : ${JSON.stringify(pr.data)}`);
  if (!pr.err) {
    check((await call(c, 'propose_race', { agentId: id, to: 'mairie' })).err, 'limite de propositions de course absente');
    H.send({ t: 'race_join', raceId: pr.data.raceId });
    const jn = await waitFor(() => H.msgs.find((m) => m.t === 'joined' && m.raceId === pr.data.raceId), 3000, 200);
    check(jn?.ok, `l'humain ne rejoint pas la course de l'IA : ${JSON.stringify(jn)}`);
    R.race2 = { id: pr.data.raceId, humanJoined: !!jn?.ok };
  }

  step('chasse');
  // chasse aux kubes dorés : l'agent ramasse le plus proche
  // la chasse en cours peut être presque finie (le test a déjà passé une bonne minute en course) : un agent qui
  // n'a plus le temps de rouler jusqu'au kube est normalement battu par la fin de chasse. On attend une chasse
  // qui laisse le temps de faire le trajet (distance à vol d'oiseau x 1,6 pour les routes, à 14 m/s, + marge).
  const huntOk = (d) => d?.kubes && d.finDansSec >= (Math.min(...d.kubes.filter((x) => !x.pris).map((x) => x.distance)) * 1.6) / 14 + 15;
  const hs = await waitFor(async () => { const d = (await call(c, 'hunt_status', { agentId: id })).data; return huntOk(d) ? d : null; }, 140000, 500);
  check(hs, 'aucune chasse démarrée');
  if (hs) {
    const k = [...hs.kubes].filter((x) => !x.pris).sort((p, q) => p.distance - q.distance)[0];
    const cc = await call(c, 'collect_kube', { agentId: id, kube: k.kube });
    check(!cc.err, `collect_kube a échoué : ${JSON.stringify(cc.data)}`);
    const got = await waitFor(async () => { const d = (await call(c, 'hunt_status', { agentId: id })).data; return d?.huntId === hs.huntId && d.prisPar?.some?.((x) => x.kube === k.kube && x.nom === 'Turbo'); }, Math.min(hs.finDansSec * 1000, (k.distance * 1.6 / 14) * 1000 + 15000), 500);
    check(got, `Turbo n'a pas ramassé le kube n°${k.kube} (distance ${k.distance} m, chasse restant ${hs.finDansSec} s)`);
    R.hunt = { kube: k.kube, distance: k.distance, ramasse: !!got };
  }

  step('classements');
  // classements
  const lb = (await call(c, 'leaderboard')).data;
  check(Array.isArray(lb.session), 'leaderboard sans classement de session');
  R.session = lb.session?.slice(0, 3);

  step('limites');
  // limites
  const ids = [id];
  for (let i = 0; i < 3; i++) { const r = await call(c, 'spawn_agent', { name: `Clone${i}` }); if (!r.err) ids.push(r.data.agentId); }
  check(ids.length === 3, `limite par clé : ${ids.length} agents créés au lieu de 3`);
  const other = await connect(`172.16.${Math.floor(Math.random() * 250)}.9`, 'intrus');
  check((await call(other, 'drive_to', { agentId: id, place: 'port' })).err, "un autre étudiant peut piloter l'agent d'autrui");
  check((await call(other, 'despawn_agent', { agentId: id })).err, "un autre étudiant peut retirer l'agent d'autrui");
  check((await call(c, 'my_agents')).data.length === 3, 'my_agents incorrect');
  check((await call(c, 'spawn_agent', { name: 'Radio Kube' })).err, "nom d'usurpation accepté");
  for (const x of ids) await call(c, 'despawn_agent', { agentId: x });
  check((await call(c, 'look', { agentId: id })).err, 'agent encore présent après despawn');
  clearInterval(H.timer); H.ws.close();
  await c.close(); await other.close();
} catch (e) {
  fails.push(`exception : ${e.stack || e.message}`);
} finally {
  server?.kill('SIGTERM');
}
console.log(JSON.stringify({ ok: !fails.length, fails, ...R }, null, 1));
process.exit(fails.length ? 1 : 0);
