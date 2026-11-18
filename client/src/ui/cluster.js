// Panneau « Infos cluster » (touche K) : lit game.net.status et /api/info. Utile pour le cours pendant les pannes.
const esc = (s) => String(s ?? '—').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtUp = (s) => (s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

export function createCluster(game, ui) {
  const el = document.createElement('div');
  el.className = 'kc-cluster'; el.style.display = 'none';
  ui.root.appendChild(el);
  const st = document.createElement('style');
  st.textContent = `.kc-cluster{position:absolute;left:18px;bottom:250px;width:min(300px,92vw);background:var(--panel2);border:1px solid var(--cyan);border-radius:12px;padding:12px 16px;font-size:14px;z-index:35;box-shadow:0 0 20px rgba(56,232,255,.2)}.kc-cluster h3{margin:0 0 8px;font-size:16px;color:var(--cyan)}.kc-cluster .r{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.07)}.kc-cluster .r span:first-child{color:var(--dim)}.kc-cluster .r b{text-align:right;word-break:break-all}.kc-cluster .r.col{flex-direction:column;gap:2px}.kc-cluster .r.col b{text-align:left;font-family:ui-monospace,monospace;font-size:13px}.kc-cluster .ok{color:var(--green)}.kc-cluster .ko{color:var(--red)}.kc-cluster .warn{color:var(--yellow)}.kc-cluster .foot{margin-top:8px;font-size:12px;color:var(--dim)}`;
  document.head.appendChild(st);
  let open = false, info = null, timer = 0;
  async function poll() {
    try { info = await (await fetch('/api/info', { cache: 'no-store' })).json(); } catch { info = null; }
    render();
  }
  function render() {
    if (!open) return;
    const s = game.net?.status || {};
    const up = !!s.connected;
    const ping = up && Number.isFinite(s.ping) ? s.ping : null;
    const pc = ping == null ? '' : ping < 80 ? 'ok' : ping < 200 ? 'warn' : 'ko';
    const redis = !up ? ['inconnu (hors ligne)', 'ko'] : s.sync === false ? ['en pause, le jeu continue sans synchro', 'warn'] : ['synchronisé', 'ok'];
    const players = info?.players ?? (game.net?.players ? game.net.players.size + 1 : null);
    const leader = s.leader ?? info?.leader;
    const row = (k, v, c = '', col = false) => `<div class="r${col ? ' col' : ''}"><span>${k}</span><b class="${c}">${v}</b></div>`;
    el.innerHTML = `<h3>Infos cluster <small style="color:var(--dim);font-weight:400">· K pour fermer</small></h3>
      ${row('Pod qui vous sert', up ? esc(s.pod) : 'reconnexion…', up ? 'ok' : 'ko', true)}
      ${s.previousPod && s.previousPod !== s.pod ? row('Pod précédent', esc(s.previousPod), 'warn', true) : ''}
      ${row('Latence', ping == null ? '—' : `${Math.round(ping)} ms`, pc)}
      ${row('Joueurs connectés', esc(players))}
      ${row('Leader des agents IA', esc(leader), leader ? 'warn' : '', true)}
      ${row('Redis (synchro)', redis[0], redis[1])}
      ${row('Reconnexions', esc(s.reconnects ?? 0), s.reconnects ? 'warn' : '')}
      ${row('Version · activité du pod', `${esc(s.version ?? info?.version)} · ${fmtUp(info?.uptimeSec)}`)}
      <div class="foot">Essayez : supprimez le pod qui vous sert, puis regardez ce panneau.</div>`;
  }
  game.bus.on('net:status', render);
  function show() { open = true; el.style.display = ''; render(); poll(); timer = setInterval(poll, 2000); }
  function hide() { open = false; el.style.display = 'none'; clearInterval(timer); }
  return { el, show, hide, toggle() { open ? hide() : show(); }, get open() { return open; } };
}
