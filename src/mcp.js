// Serveur MCP (HTTP « streamable », sans session) : chaque requête peut tomber sur n'importe quel pod.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as store from "./store.js";
import * as game from "./game.js";
import { districtAt } from "./city.js";

const VERSION = process.env.APP_VERSION || "dev";
const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

function buildServer(players) {
  const s = new McpServer({ name: "kube-city", version: VERSION }, {
    instructions:
      "Tu pilotes un agent (un véhicule) dans Kube City, une ville 3D de 1200 m x 1200 m ; coordonnées x/z en mètres. Crée d'abord ton agent avec spawn_agent, " +
      "garde son agentId, puis regarde autour (look), déplace-toi (drive_to), parle aux joueurs (say) et propose des courses de rue (propose_race). " +
      "Reste fair-play et bienveillant dans le chat : de vrais étudiants jouent.",
  });

  s.registerTool("spawn_agent", {
    title: "Créer un agent",
    description: "Fait apparaître ton agent (une voiture) dans la ville. Renvoie son agentId, à réutiliser dans les autres outils.",
    inputSchema: { name: z.string().min(1).max(24).describe("Nom affiché au-dessus de la voiture"), color: z.string().optional().describe("Couleur hexadécimale, ex. #39ff88") },
  }, async ({ name, color }) => {
    const bot = await game.spawnBot({ name, color });
    return text({ agentId: bot.id, ...game.describe(bot), conseil: "Utilise list_places pour connaître les destinations." });
  });

  s.registerTool("list_places", {
    title: "Lieux de la ville",
    description: "Liste les lieux nommés (clé, nom, coordonnées x/z en mètres) où l'on peut se rendre ou finir une course.",
    inputSchema: {},
  }, async () => text(game.placeList()));

  s.registerTool("look", {
    title: "Regarder autour",
    description: "Position de l'agent, joueurs proches, courses ouvertes, derniers messages du chat et classement.",
    inputSchema: { agentId: z.string() },
  }, async ({ agentId }) => {
    const bot = await store.loadBot(agentId);
    if (!bot) return fail("Agent inconnu : recrée-le avec spawn_agent.");
    const near = [...players().values()]
      .filter((p) => p.id !== bot.id)
      .map((p) => ({ name: p.name, bot: !!p.bot, distance: Math.round(Math.hypot(p.p[0] - bot.x, p.p[2] - bot.z)), quartier: districtAt(p.p[0], p.p[2]).name }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
    const races = (await store.listRaces()).map((r) => ({ raceId: r.id, vers: r.toLabel, par: r.creatorName, statut: game.raceStatus(r), departDansSec: Math.max(0, Math.round((r.startAt - Date.now()) / 1000)) }));
    return text({
      moi: game.describe(bot),
      autour: near,
      courses: races.filter((r) => r.statut !== "terminée"),
      chat: (await store.recentChat(8)).map((m) => `${m.from} : ${m.text}`),
      classement: await store.leaderboard(5),
    });
  });

  s.registerTool("drive_to", {
    title: "Rouler vers un lieu",
    description: "L'agent roule par les rues jusqu'à un lieu nommé (voir list_places).",
    inputSchema: { agentId: z.string(), place: z.string().describe("Clé du lieu, ex. jetee, port, mairie, stade") },
  }, async ({ agentId, place }) => {
    try { return text(game.describe(await game.botDriveTo(agentId, place))); } catch (e) { return fail(e.message); }
  });

  s.registerTool("say", {
    title: "Parler",
    description: "Envoie un message dans le chat de la ville, visible par tous les joueurs.",
    inputSchema: { agentId: z.string(), message: z.string().min(1).max(160) },
  }, async ({ agentId, message }) => {
    const bot = await store.loadBot(agentId);
    if (!bot) return fail("Agent inconnu.");
    await store.pushChat({ from: `${bot.name} (IA)`, text: message, ts: Date.now() });
    return text("Message envoyé.");
  });

  s.registerTool("propose_race", {
    title: "Proposer une course de rue",
    description: "Lance une course depuis la position de l'agent vers un lieu. Départ dans 20 s ; les joueurs la rejoignent depuis leur téléphone. L'agent y participe.",
    inputSchema: { agentId: z.string(), to: z.string().describe("Clé du lieu d'arrivée") },
  }, async ({ agentId, to }) => {
    const bot = await store.loadBot(agentId);
    if (!bot) return fail("Agent inconnu.");
    try {
      const race = await game.createRace({ creatorId: bot.id, creatorName: `${bot.name} (IA)`, from: bot, toKey: to });
      await game.botJoinRace(bot.id, race.id);
      return text({ raceId: race.id, vers: race.toLabel, departDansSec: 20 });
    } catch (e) { return fail(e.message); }
  });

  s.registerTool("join_race", {
    title: "Rejoindre une course",
    description: "Inscrit l'agent à une course ouverte (voir look) : il va à la ligne de départ puis court.",
    inputSchema: { agentId: z.string(), raceId: z.string() },
  }, async ({ agentId, raceId }) => {
    try { const { race } = await game.botJoinRace(agentId, raceId); return text(`Inscrit à la course vers ${race.toLabel}.`); } catch (e) { return fail(e.message); }
  });

  s.registerTool("leaderboard", {
    title: "Classement",
    description: "Les 10 meilleurs scores de la ville.",
    inputSchema: {},
  }, async () => text(await store.leaderboard(10)));

  s.registerTool("despawn_agent", {
    title: "Retirer l'agent",
    description: "Fait quitter la ville à l'agent.",
    inputSchema: { agentId: z.string() },
  }, async ({ agentId }) => { await store.deleteBot(agentId); return text("Agent retiré."); });

  return s;
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
  const server = buildServer(players);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
