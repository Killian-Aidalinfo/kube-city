// Serveur MCP (HTTP « streamable », sans session) : chaque requête peut tomber sur n'importe quel pod.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as store from "./store.js";
import * as game from "./game.js";
import crypto from "node:crypto";
import { districtAt, HALF } from "./city.js";
import { EMOTES } from "./protocol.js";

const VERSION = process.env.APP_VERSION || "dev";
const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

// ---------- Limites (jeu public : un étudiant ne doit pas saturer le cluster) ----------
// Tout est compté dans Redis, donc commun à tous les pods. Réglable par variables d'environnement.
const LIM = {
  perKey: Number(process.env.MCP_MAX_BOTS_PER_KEY || 3),    // agents par clé (en-tête X-Kube-Key, sinon l'IP)
  perIp: Number(process.env.MCP_MAX_BOTS_PER_IP || 40),     // agents par adresse IP (toute une classe sort souvent par la même IP NAT)
  total: Number(process.env.MCP_MAX_BOTS || 40),            // agents dans toute la ville
  rpm: Number(process.env.MCP_RPM || 3000),                  // requêtes MCP par minute et par IP
  spawnPerMin: Number(process.env.MCP_SPAWN_PER_MIN || 40),  // créations d'agents par minute et par IP
  chatPerMin: Number(process.env.MCP_CHAT_PER_MIN || 120),   // messages de chat par minute et par IP
  openRaces: Number(process.env.MCP_MAX_OPEN_RACES || 6),   // courses ouvertes en même temps
};
export const MCP_LIMITS = LIM;
const bad = (s) => /radio\s*kube/i.test(s);
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * IP du client : on prend l'adresse ajoutée par NOTRE proxy, pas celle que le client a pu écrire (entrée la plus à gauche, falsifiable).
 * TRUST_PROXY_HOPS = nombre de proxys de confiance devant l'app (défaut 1 : entrée la plus à droite) ; 0 = ignorer X-Forwarded-For.
 */
export function clientIp(req, hops = Number(process.env.TRUST_PROXY_HOPS ?? 1)) {
  const peer = req.socket?.remoteAddress || "?";
  const n = Number.isFinite(hops) ? Math.floor(hops) : 1;
  if (n <= 0) return peer;
  const list = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!list.length) return peer;
  return list[Math.max(0, list.length - n)];
}

/** Qui appelle : IP (X-Forwarded-For, voir clientIp) et clé facultative (X-Kube-Key) pour distinguer des élèves derrière la même box. */
export function whoIs(req) {
  const ip = clientIp(req);
  const k = String(req.headers["x-kube-key"] || "").trim().slice(0, 40);
  const key = crypto.createHash("sha1").update(k || ip).digest("hex").slice(0, 12);
  return { ip: crypto.createHash("sha1").update(ip).digest("hex").slice(0, 12), key, keyed: !!k };
}
const ok = (who, name, limit, sec) => store.rateLimit(`mcp:${name}:${who.ip}`, limit, sec);

function buildServer(players, who) {
  const s = new McpServer({ name: "kube-city", version: VERSION }, {
    instructions:
      "Tu pilotes un agent (un véhicule) dans Kube City, une ville 3D de 1200 m x 1200 m ; coordonnées x/z en mètres. Crée d'abord ton agent avec spawn_agent, " +
      "garde son agentId, puis regarde autour (look), déplace-toi (drive_to / drive_to_xy), parle aux joueurs (say, emote), propose ou rejoins des courses (propose_race, join_race, race_status) " +
      "et chasse les kubes dorés quand une chasse est ouverte (hunt_status puis collect_kube). Pour rejoindre une course il faut être à moins de 200 m du départ : va d'abord à ses coordonnées `depart`. " +
      "Les inscriptions durent ~30 s : sois rapide. Reste fair-play et bienveillant dans le chat : de vrais étudiants jouent. Ne spamme pas (messages limités en fréquence).",
  });
  // avec une X-Kube-Key, seule la clé compte : derrière la même IP NAT, un élève ne pilote pas les agents des autres
  const mine = (bot) => bot.owner === who.key || (!who.keyed && bot.ip === who.ip);
  /** Charge l'agent et vérifie qu'il appartient bien à l'appelant. */
  const own = async (agentId) => {
    const bot = await store.loadBot(agentId);
    if (!bot) return { err: fail("Agent inconnu (expiré après 30 min d'inactivité ?) : recrée-le avec spawn_agent.") };
    if (!mine(bot)) return { err: fail("Cet agent appartient à quelqu'un d'autre.") };
    return { bot };
  };
  const guarded = (fn) => async (a) => { try { return await fn(a); } catch (e) { return fail(e.message); } };
  const tag = (bot) => `${bot.name} (IA)`;

  s.registerTool("spawn_agent", {
    title: "Créer un agent",
    description: `Fait apparaître ton agent (une voiture) dans la ville. Renvoie son agentId, à réutiliser dans les autres outils. Limites : ${LIM.perKey} agents par clé/IP. Un agent inactif 30 min disparaît ; retire-le avec despawn_agent quand tu as fini.`,
    inputSchema: { name: z.string().min(1).max(24).describe("Nom affiché au-dessus de la voiture"), color: z.string().optional().describe("Couleur hexadécimale, ex. #39ff88") },
  }, guarded(async ({ name, color }) => {
    name = clean(name, 24);
    if (!name || bad(name)) return fail("Nom invalide.");
    if (!(await ok(who, "spawn", LIM.spawnPerMin, 60))) return fail("Trop de créations d'agents : attends une minute.");
    const bots = await store.listBots();
    if (bots.length >= LIM.total) return fail(`La ville est pleine (${LIM.total} agents) : réessaie plus tard.`);
    if (bots.filter((b) => b.ip === who.ip).length >= LIM.perIp) return fail(`Limite atteinte : ${LIM.perIp} agents par adresse IP.`);
    if (bots.filter((b) => b.owner === who.key).length >= LIM.perKey) return fail(`Limite atteinte : ${LIM.perKey} agents par clé (sans en-tête X-Kube-Key, la clé est ton IP : si plusieurs personnes partagent la même IP, chacune doit envoyer sa propre clé X-Kube-Key). Retire-en un avec despawn_agent (liste : my_agents).`);
    const bot = await game.spawnBot({ name, color, owner: who.key, ip: who.ip });
    return text({ agentId: bot.id, ...game.describe(bot), conseil: "Utilise list_places pour connaître les destinations, puis look." });
  }));

  s.registerTool("my_agents", {
    title: "Mes agents",
    description: "Liste les agents que tu as créés (utile si tu as perdu un agentId).",
    inputSchema: {},
  }, guarded(async () => text((await store.listBots()).filter(mine).map((b) => ({ agentId: b.id, ...game.describe(b) })))));

  s.registerTool("list_places", {
    title: "Lieux de la ville",
    description: "Liste les lieux nommés (clé, nom, coordonnées x/z en mètres) où l'on peut se rendre ou finir une course.",
    inputSchema: {},
  }, async () => text(game.placeList()));

  s.registerTool("get_map", {
    title: "Carte de la ville",
    description: "La ville : taille, lieux, quartiers et position de l'agent. Les coordonnées vont de -600 à +600 m ; x vers l'est, z vers le sud.",
    inputSchema: { agentId: z.string().optional() },
  }, guarded(async ({ agentId }) => {
    const bot = agentId ? (await own(agentId)).bot : null;
    const quartiers = {};
    for (let x = -HALF + 50; x < HALF; x += 100) for (let zz = -HALF + 50; zz < HALF; zz += 100) {
      const d = districtAt(x, zz).name;
      (quartiers[d] ||= []).push([x, zz]);
    }
    return text({
      tailleM: HALF * 2, xDe: -HALF, xA: HALF, zDe: -HALF, zA: HALF,
      lieux: game.placeList(),
      quartiers: Object.fromEntries(Object.entries(quartiers).map(([n, pts]) => [n, { exemple: { x: pts[0][0], z: pts[0][1] }, zones100m: pts.length }])),
      moi: bot ? game.describe(bot) : undefined,
    });
  }));

  s.registerTool("look", {
    title: "Regarder autour",
    description: "Position de l'agent, joueurs proches (avec x/z), courses ouvertes (avec le point de départ), chasse aux kubes en cours, derniers messages du chat et classement.",
    inputSchema: { agentId: z.string() },
  }, guarded(async ({ agentId }) => {
    const { bot, err } = await own(agentId);
    if (err) return err;
    const near = [...players().values()]
      .filter((p) => p.id !== bot.id)
      .map((p) => ({ name: p.name, ia: !!p.bot, x: Math.round(p.p[0]), z: Math.round(p.p[2]), distance: Math.round(Math.hypot(p.p[0] - bot.x, p.p[2] - bot.z)), quartier: districtAt(p.p[0], p.p[2]).name, enVehicule: !!p.veh }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
    const races = (await store.listRaces()).map((r) => ({ raceId: r.id, vers: r.toLabel, par: r.creatorName, statut: game.raceStatus(r), depart: r.from, distanceDuDepart: Math.round(Math.hypot(r.from.x - bot.x, r.from.z - bot.z)), inscrits: Object.values(r.entrants || {}), departDansSec: Math.max(0, Math.round((r.startAt - Date.now()) / 1000)), terminee: !!r.closed }));
    const hunt = await store.huntView();
    return text({
      moi: game.describe(bot),
      autour: near,
      courses: races.filter((r) => r.statut !== "terminée" && !r.terminee),
      chasse: hunt ? huntInfo(hunt, bot) : "aucune chasse en cours",
      chat: (await store.recentChat(8)).map((m) => `${m.from} : ${m.text}`),
      classement: await store.leaderboard(5),
    });
  }));

  s.registerTool("nearby_players", {
    title: "Joueurs proches",
    description: "Les 15 joueurs et agents les plus proches de l'agent, avec position x/z et distance (pour défier ou suivre quelqu'un).",
    inputSchema: { agentId: z.string() },
  }, guarded(async ({ agentId }) => {
    const { bot, err } = await own(agentId);
    if (err) return err;
    return text([...players().values()].filter((p) => p.id !== bot.id).map((p) => ({ name: p.name, ia: !!p.bot, x: Math.round(p.p[0]), z: Math.round(p.p[2]), distance: Math.round(Math.hypot(p.p[0] - bot.x, p.p[2] - bot.z)), enVehicule: !!p.veh })).sort((a, b) => a.distance - b.distance).slice(0, 15));
  }));

  s.registerTool("drive_to", {
    title: "Rouler vers un lieu",
    description: "L'agent roule par les rues jusqu'à un lieu nommé (voir list_places). Il roule ~50 km/h ; suis sa progression avec look.",
    inputSchema: { agentId: z.string(), place: z.string().describe("Clé du lieu, ex. jetee, port, mairie, stade") },
  }, guarded(async ({ agentId, place }) => {
    const { err } = await own(agentId);
    if (err) return err;
    return text(game.describe(await game.botDriveTo(agentId, place)));
  }));

  s.registerTool("drive_to_xy", {
    title: "Rouler vers des coordonnées",
    description: "Comme drive_to mais vers un point x/z en mètres (par ex. le `depart` d'une course ou la position d'un joueur).",
    inputSchema: { agentId: z.string(), x: z.number(), z: z.number() },
  }, guarded(async ({ agentId, x, z: zz }) => {
    const { err } = await own(agentId);
    if (err) return err;
    return text(game.describe(await game.botDriveToXY(agentId, x, zz)));
  }));

  s.registerTool("say", {
    title: "Parler",
    description: "Envoie un message dans le chat de la ville, visible par tous les joueurs (affiché avec le badge IA). Limité : 1 message toutes les 3 s.",
    inputSchema: { agentId: z.string(), message: z.string().min(1).max(160) },
  }, guarded(async ({ agentId, message }) => {
    const { bot, err } = await own(agentId);
    if (err) return err;
    const msg = clean(message, 160);
    if (!msg) return fail("Message vide.");
    if (!(await store.rateLimit(`mcp:say:${bot.id}`, 1, 3)) || !(await ok(who, "chat", LIM.chatPerMin, 60))) return fail("Tu parles trop vite : attends quelques secondes.");
    await store.pushChat({ from: tag(bot), bot: true, text: msg, ts: Date.now() });
    return text("Message envoyé.");
  }));

  s.registerTool("emote", {
    title: "Faire une emote",
    description: `Fait une emote visible au-dessus de la voiture : ${EMOTES.join(", ")}. 1 par seconde.`,
    inputSchema: { agentId: z.string(), emote: z.enum(EMOTES) },
  }, guarded(async ({ agentId, emote }) => {
    const { bot, err } = await own(agentId);
    if (err) return err;
    if (!(await store.rateLimit(`mcp:emote:${bot.id}`, 1, 1))) return fail("Trop d'emotes : une par seconde.");
    await store.publish({ k: "emote", id: bot.id, e: emote });
    return text("Emote envoyée.");
  }));

  s.registerTool("propose_race", {
    title: "Proposer une course de rue",
    description: "Lance une course depuis la position de l'agent vers un lieu. Départ dans ~30 s ; les joueurs la rejoignent depuis leur téléphone (ou leur agent avec join_race). L'agent y participe automatiquement. Une proposition toutes les 20 s.",
    inputSchema: { agentId: z.string(), to: z.string().describe("Clé du lieu d'arrivée") },
  }, guarded(async ({ agentId, to }) => {
    const { bot, err } = await own(agentId);
    if (err) return err;
    if (!(await ok(who, "race", 1, 20))) return fail("Une course à la fois : réessaie dans quelques secondes.");
    const open = (await store.listRaces()).filter((r) => game.raceStatus(r) !== "terminée" && !r.closed);
    if (open.length >= LIM.openRaces) return fail("Déjà beaucoup de courses ouvertes : rejoins-en une avec join_race.");
    const race = await game.createRace({ creatorId: bot.id, creatorName: tag(bot), from: bot, toKey: to });
    await game.botJoinRace(bot.id, race.id);
    return text({ raceId: race.id, vers: race.toLabel, depart: race.from, departDansSec: Math.round((race.startAt - Date.now()) / 1000), conseil: "Suis la course avec race_status." });
  }));

  s.registerTool("join_race", {
    title: "Rejoindre une course",
    description: "Inscrit l'agent à une course ouverte (voir look), y compris celle d'un humain. Il faut être à moins de 200 m du départ et avant le départ. Une fois inscrit, l'agent attend le signal puis court tout seul.",
    inputSchema: { agentId: z.string(), raceId: z.string() },
  }, guarded(async ({ agentId, raceId }) => {
    const { err } = await own(agentId);
    if (err) return err;
    const { race } = await game.botJoinRace(agentId, raceId);
    return text(`Inscrit à la course vers ${race.toLabel}. Départ dans ${Math.max(0, Math.round((race.startAt - Date.now()) / 1000))} s.`);
  }));

  s.registerTool("race_status", {
    title: "État d'une course",
    description: "Statut d'une course (inscriptions, en cours, terminée), inscrits et arrivées avec temps. Sans raceId : les courses actives.",
    inputSchema: { raceId: z.string().optional() },
  }, guarded(async ({ raceId }) => {
    const ids = raceId ? [raceId] : (await store.listRaces()).map((r) => r.id);
    const out = [];
    for (const id of ids) {
      const r = await store.raceView(id);
      if (!r) { if (raceId) return fail("Course inconnue ou expirée."); continue; }
      const b = await store.raceBoard(id);
      out.push({ raceId: id, vers: r.toLabel, par: r.creatorName, statut: r.closed ? "terminée" : game.raceStatus(r), depart: r.from, departDansSec: Math.max(0, Math.round((r.startAt - Date.now()) / 1000)), classement: b.rows.map((x, i) => ({ place: x.ms != null ? i + 1 : null, nom: x.name, secondes: x.ms != null ? +(x.ms / 1000).toFixed(1) : null })) });
    }
    return text(raceId ? out[0] : out);
  }));

  s.registerTool("hunt_status", {
    title: "Chasse aux kubes dorés",
    description: "La chasse aux kubes dorés en cours (toutes les ~10 min, 3 min) : position des kubes restants, qui en a pris. Le plus rapide en ramasse le plus gagne 500 €.",
    inputSchema: { agentId: z.string().optional() },
  }, guarded(async ({ agentId }) => {
    const hunt = await store.huntView();
    if (!hunt) return text("Aucune chasse en cours. Elles reviennent toutes les ~10 minutes ; une annonce passe dans le chat de Radio Kube.");
    const bot = agentId ? (await own(agentId)).bot : null;
    return text(huntInfo(hunt, bot));
  }));

  s.registerTool("collect_kube", {
    title: "Ramasser un kube doré",
    description: "Envoie l'agent ramasser le kube doré n° i de la chasse en cours (voir hunt_status) : il roule jusque-là et le réclame à l'arrivée. Premier arrivé, premier servi.",
    inputSchema: { agentId: z.string(), kube: z.number().int().min(0).max(20) },
  }, guarded(async ({ agentId, kube }) => {
    const { err } = await own(agentId);
    if (err) return err;
    const { bot, kube: k } = await game.botGoForKube(agentId, kube);
    return text({ ...game.describe(bot), kube: k, conseil: "Surveille avec hunt_status si quelqu'un te le prend." });
  }));

  s.registerTool("leaderboard", {
    title: "Classement",
    description: "Classement général (top 10 des scores) et classement de la session (argent gagné, courses, kubes ramassés).",
    inputSchema: {},
  }, guarded(async () => text({ scores: await store.leaderboard(10), session: await store.sessionBoard(10) })));

  s.registerTool("despawn_agent", {
    title: "Retirer l'agent",
    description: "Fait quitter la ville à l'agent (libère un emplacement).",
    inputSchema: { agentId: z.string() },
  }, guarded(async ({ agentId }) => {
    const { err } = await own(agentId);
    if (err) return err;
    await store.deleteBot(agentId);
    return text("Agent retiré.");
  }));

  return s;
}

function huntInfo(hunt, bot) {
  return {
    huntId: hunt.id, finDansSec: Math.max(0, Math.round((hunt.endAt - Date.now()) / 1000)), prix: hunt.prize,
    kubes: hunt.kubes.map((k) => ({ kube: k.i, x: k.x, z: k.z, pris: !!hunt.claims[k.i], parQui: hunt.names[hunt.claims[k.i]], distance: bot ? Math.round(Math.hypot(k.x - bot.x, k.z - bot.z)) : undefined })),
    prisPar: Object.entries(hunt.claims).map(([i, id]) => ({ kube: Number(i), nom: hunt.names[id] })),
  };
}

export async function handleMcp(req, res, body, players) {
  const token = process.env.MCP_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "jeton MCP manquant ou invalide" }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" }).end();
    return;
  }
  const who = whoIs(req);
  // plafond de requêtes par IP et par minute (si Redis est indisponible, la requête échouera plus loin de toute façon)
  if (store.redisReady() && !(await ok(who, "rpm", LIM.rpm, 60).catch(() => true))) {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "10" }).end(JSON.stringify({ error: "trop de requêtes MCP : ralentis" }));
    return;
  }
  const server = buildServer(players, who);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
