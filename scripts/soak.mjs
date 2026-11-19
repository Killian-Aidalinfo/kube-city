#!/usr/bin/env node
// Endurance serveur : charge continue + chaos périodique, relevé chaque minute de la mémoire des pods,
// des clés Redis et de la latence. Cherche ce qui monte et ne redescend jamais.
//   COMPOSE_PROJECT_NAME=kc-soak LB_PORT=8314 node scripts/soak.mjs --minutes 25 --players 40 --agents 5 --chaos-every 4
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
const ex = promisify(execFile);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const MIN = +arg("minutes", 25), PLAYERS = +arg("players", 40), AGENTS = +arg("agents", 5), EVERY = +arg("chaos-every", 4);
const PORT = process.env.LB_PORT || 8080, REDIS_SVC = process.env.REDIS_SERVICE || "redis"; // "auto" = variante Sentinel
let REDIS = REDIS_SVC;
async function pickMaster() { // service Redis qui est maître en ce moment
  if (REDIS_SVC !== "auto") return;
  for (const s of ["redis-a", "redis-b", "redis-c"]) if ((await dc("exec", "-T", s, "redis-cli", "role")).startsWith("master")) { REDIS = s; return; }
}
const dc = (...a) => ex("docker", ["compose", ...a], { timeout: 15000 }).then((r) => r.stdout).catch(() => "");
const kinds = ["pod", "redis", "podrestart"];
const chaos = []; for (let m = EVERY, i = 0; m < MIN; m += EVERY, i++) chaos.push(`${kinds[i % 3]}@${m * 60}`);
const load = spawn("node", ["scripts/charge.mjs", "--url", `http://localhost:${PORT}`, "--players", PLAYERS, "--agents", AGENTS, "--duration", MIN * 60, "--churn", 45, "--redis-service", REDIS_SVC, "--redis-back", 25, "--chaos", chaos.join(",")], { stdio: ["ignore", "pipe", "inherit"] });
let lastLine = "", lat = ""; load.stdout.on("data", (d) => { const l = String(d).trim().split("\n"); lastLine = l.at(-1); if (/CHAOS/.test(d)) console.log(String(d).trim()); });
const t0 = Date.now(); const rows = [];
async function sample() {
  const row = { min: Math.round((Date.now() - t0) / 60000) };
  const stats = await ex("docker", ["stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}"], { timeout: 20000 }).then((r) => r.stdout).catch(() => "");
  for (const l of stats.trim().split("\n")) { const m = l.match(/(game-\d|redis)\S*\s+([\d.]+)(MiB|GiB|KiB)/); if (m) row[m[1] + "_rss"] = Math.round(m[2] * (m[3] === "GiB" ? 1024 : m[3] === "KiB" ? 1 / 1024 : 1)); }
  for (const n of [1, 2, 3]) {
    const t = await dc("exec", "-T", `game-${n}`, "wget", "-qO-", "http://localhost:8080/metrics");
    const g = (re) => { const m = t.match(re); return m ? Math.round(+m[1] / 1048576) : null; };
    row[`g${n}_heapMo`] = g(/^nodejs_heap_size_used_bytes (\S+)/m); row[`g${n}_extMo`] = g(/^nodejs_external_memory_bytes (\S+)/m);
    const h = t.match(/^nodejs_active_handles_total (\S+)/m); row[`g${n}_handles`] = h ? +h[1] : null;
  }
  await pickMaster();
  row.dbsize = +(await dc("exec", "-T", REDIS, "redis-cli", "dbsize")).replace(/\D/g, "") || null;
  for (const [k, c] of [["names", "hlen pn:names"], ["scores", "zcard pn:scores"], ["chat", "llen pn:chat"], ["journal", "llen pn:journal"], ["hbh", "zcard pn:hbh"], ["pods", "zcard pn:pods"], ["races", "scard pn:races"], ["bots", "scard pn:bots"]])
    row[k] = +(await dc("exec", "-T", REDIS, "redis-cli", ...c.split(" "))).replace(/\D/g, "");
  row.redisKb = +((await dc("exec", "-T", REDIS, "redis-cli", "info", "memory")).match(/used_memory:(\d+)/)?.[1] / 1024).toFixed(0) || null;
  row.load = lastLine.replace(/^\[\d+s\] /, "").slice(0, 110);
  rows.push(row); console.log(JSON.stringify(row));
}
const iv = setInterval(sample, 60000);
load.on("exit", async () => { clearInterval(iv); await sample(); console.log("SOAK-FIN"); process.exit(0); });
