// Connexion WebSocket v2 résiliente : reconnexion invisible (attente aléatoire croissante), ping, file d'envoi.
// Sans dépendance au DOM (WebSocket et horloges injectables) : testée dans test/net.test.js.
export const PROTOCOL = 2;

/** Attente avant la n-ième tentative : aléatoire dans [0, min(plafond, base·2^n)], au moins 100 ms. */
export function backoffDelay(attempt, rand = Math.random, base = 250, cap = 5000) {
  return Math.round(100 + rand() * Math.max(0, Math.min(cap, base * 2 ** attempt) - 100));
}

// enveloppes : les fonctions natives refusent d'être appelées avec `timers` comme `this` (Illegal invocation)
const defaultTimers = {
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (i) => clearTimeout(i),
  setInterval: (f, ms) => setInterval(f, ms), clearInterval: (i) => clearInterval(i),
};

/**
 * @param {object} o
 * @param {() => string} o.url
 * @param {() => object} o.hello  message hello (appelé à chaque (re)connexion)
 * @param {(msg: object) => void} o.onMessage
 * @param {(ev: { type: 'open'|'close'|'ping', ...}) => void} o.onEvent
 */
export function createConnection({ url, hello, onMessage, onEvent, WS = globalThis.WebSocket, now = () => Date.now(), timers = defaultTimers, rand = Math.random, pingMs = 2000 }) {
  let ws = null, attempt = 0, retryTimer = null, pingTimer = null, stopped = false, everOpen = false, opened = false;

  function scheduleRetry() {
    if (stopped || retryTimer) return;
    retryTimer = timers.setTimeout(() => { retryTimer = null; open(); }, backoffDelay(attempt++, rand));
  }

  function open() {
    if (stopped) return;
    try { ws = new WS(url()); } catch { scheduleRetry(); return; }
    const sock = ws;
    sock.onopen = () => {
      if (sock !== ws) return;
      opened = true;
      attempt = 0;
      const re = everOpen;
      everOpen = true;
      sock.send(JSON.stringify({ t: "hello", v: PROTOCOL, ...hello(), re }));
      timers.clearInterval(pingTimer);
      pingTimer = timers.setInterval(() => api.send({ t: "ping", ts: now() }), pingMs);
      onEvent({ type: "open", reconnect: re });
    };
    sock.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === "pong") onEvent({ type: "ping", ms: Math.max(0, now() - m.ts), leader: !!m.leader });
      else onMessage(m);
    };
    sock.onclose = (e) => {
      if (sock !== ws) return;
      timers.clearInterval(pingTimer);
      const wasOpen = opened;
      opened = false;
      ws = null;
      onEvent({ type: "close", code: e?.code, wasOpen });
      // 4001 : protocole refusé, inutile d'insister
      if (e?.code === 4001) { stopped = true; return; }
      scheduleRetry();
    };
    sock.onerror = () => { /* onclose suit toujours : on y gère la reprise */ };
  }

  const api = {
    get open() { return !!ws && ws.readyState === 1; },
    /** Envoie un message ; ignoré (sans erreur) si la connexion est coupée : le jeu continue en local. */
    send(msg) {
      if (!api.open) return false;
      try { ws.send(JSON.stringify(msg)); return true; } catch { return false; }
    },
    /** Referme la socket pour que la reprise renvoie un `hello` à jour (ex. pseudo choisi après la connexion). */
    reopen() { if (ws) { try { ws.close(); } catch { /* déjà fermée */ } } },
    connect() { stopped = false; if (!ws && !retryTimer) open(); },
    close() { stopped = true; timers.clearTimeout(retryTimer); timers.clearInterval(pingTimer); retryTimer = null; try { ws?.close(); } catch {} ws = null; },
  };
  return api;
}
