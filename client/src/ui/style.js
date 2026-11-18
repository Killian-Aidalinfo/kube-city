// Feuille de style néon de l'interface, injectée une seule fois dans le document.
const CSS = `
:root { --bg:#0b1020; --panel:rgba(12,18,40,.84); --panel2:rgba(22,30,62,.9); --line:rgba(130,160,255,.3); --cyan:#38e8ff; --pink:#ff4fa3; --yellow:#ffd23f; --green:#7bf59a; --red:#ff5a6a; --text:#eaf0ff; --dim:#9aa8cc; --font:'Trebuchet MS','Segoe UI',system-ui,sans-serif; }
#ui-root, #ui-root * { box-sizing:border-box; font-family:var(--font); }
#ui-root > .kc-hud { position:absolute; inset:0; pointer-events:none; z-index:20; color:var(--text); }
.kc-hud .kc-ptr { pointer-events:auto; }
#ui-root > .kc-hud.menu { z-index:62; } .kc-hud.menu > *:not(.kc-ha) { display:none !important; }
.kc-glow { text-shadow:0 0 6px currentColor,0 0 18px currentColor; }
/* minimap */
.kc-mini { position:absolute; left:18px; bottom:18px; width:236px; height:236px; }
.kc-mini canvas { width:236px; height:236px; display:block; }
.kc-mini .kc-district { position:absolute; left:0; right:0; bottom:-4px; text-align:center; font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--cyan); text-shadow:0 0 6px #000; }
.kc-hint { position:absolute; left:50%; bottom:92px; transform:translateX(-50%); background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 14px; font-size:14px; color:var(--dim); transition:opacity .4s; }
/* haut droit */
.kc-tr { position:absolute; right:22px; top:16px; text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
.kc-stars { font-size:28px; letter-spacing:4px; color:rgba(255,255,255,.18); }
.kc-stars .on { color:var(--yellow); text-shadow:0 0 10px var(--yellow); }
.kc-stars.search .on { animation:kc-blink .6s infinite; }
@keyframes kc-blink { 50% { opacity:.25; } }
.kc-money { font-size:26px; font-weight:700; color:var(--green); text-shadow:0 0 10px rgba(123,245,154,.6); }
.kc-money small { display:block; font-size:12px; font-weight:400; color:var(--dim); text-shadow:none; }
.kc-weapon { font-size:14px; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:4px 10px; }
.kc-abil { width:150px; font-size:12px; color:var(--dim); text-align:right; }
.kc-abil .bar { height:6px; background:rgba(255,255,255,.12); border-radius:3px; margin-top:3px; overflow:hidden; }
.kc-abil .bar i { display:block; height:100%; background:var(--cyan); box-shadow:0 0 8px var(--cyan); }
.kc-abil.ready b { color:var(--cyan); }
.kc-obj { max-width:360px; background:var(--panel); border:1px solid var(--line); border-right:4px solid var(--yellow); border-radius:8px; padding:10px 14px; text-align:left; }
.kc-obj h4 { margin:0 0 4px; font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--yellow); }
.kc-obj p { margin:0; font-size:15px; line-height:1.3; }
.kc-obj .t { margin-top:4px; font-size:13px; color:var(--cyan); }
/* haut gauche : notifications */
.kc-notifs { position:absolute; left:18px; top:58px; width:340px; display:flex; flex-direction:column; gap:6px; }
.kc-notif { background:var(--panel); border:1px solid var(--line); border-left:4px solid var(--cyan); border-radius:6px; padding:8px 12px; font-size:14px; animation:kc-in .25s ease-out; }
.kc-notif.success { border-left-color:var(--green); } .kc-notif.warning { border-left-color:var(--yellow); } .kc-notif.danger { border-left-color:var(--red); }
.kc-notif.out { opacity:0; transform:translateX(-20px); transition:all .35s; }
@keyframes kc-in { from { opacity:0; transform:translateX(-24px); } }
/* panneau HA */
.kc-ha { position:absolute; left:50%; top:10px; transform:translateX(-50%); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:5px 14px; font-size:12.5px; display:flex; gap:12px; align-items:center; white-space:nowrap; cursor:pointer; user-select:none; }
.kc-ha .dot { width:10px; height:10px; border-radius:50%; background:var(--green); box-shadow:0 0 8px var(--green); }
.kc-ha.down .dot { background:var(--red); box-shadow:0 0 8px var(--red); animation:kc-blink .7s infinite; }
.kc-ha .k { color:var(--dim); } .kc-ha .v { color:var(--text); font-weight:700; }
.kc-ha .lead { color:var(--yellow); }
.kc-ha.collapsed .more { display:none; }
.kc-ha .tog { color:var(--dim); font-size:11px; }
/* bas */
.kc-sub { position:absolute; left:50%; bottom:34px; transform:translateX(-50%); width:min(760px,60vw); text-align:center; display:flex; flex-direction:column; gap:6px; align-items:center; }
.kc-sub div { background:rgba(0,0,0,.62); border-radius:8px; padding:7px 14px; font-size:18px; line-height:1.3; }
.kc-sub b { color:var(--yellow); margin-right:6px; }
.kc-prompt { position:absolute; left:50%; bottom:150px; transform:translateX(-50%); background:var(--panel2); border:1px solid var(--cyan); box-shadow:0 0 14px rgba(56,232,255,.4); border-radius:8px; padding:8px 18px; font-size:17px; font-weight:700; }
.kc-speed { position:absolute; right:26px; bottom:22px; text-align:right; }
.kc-speed .n { font-size:64px; font-weight:700; line-height:1; text-shadow:0 0 16px var(--cyan); }
.kc-speed .u { font-size:14px; color:var(--dim); margin-left:6px; }
.kc-speed .r { font-size:14px; color:var(--pink); text-shadow:0 0 8px var(--pink); margin-top:4px; }
.kc-banner { position:absolute; left:50%; top:26%; transform:translateX(-50%); text-align:center; animation:kc-pop .5s ease-out; }
.kc-banner h2 { margin:0; font-size:52px; letter-spacing:.12em; text-transform:uppercase; color:var(--green); text-shadow:0 0 22px var(--green); }
.kc-banner p { margin:8px 0 0; font-size:20px; text-shadow:0 0 6px #000; }
.kc-banner .rw { font-size:30px; color:var(--yellow); font-weight:700; text-shadow:0 0 14px var(--yellow); }
@keyframes kc-pop { from { opacity:0; transform:translateX(-50%) scale(.7); } }
/* écrans */
.kc-screen { position:absolute; inset:0; z-index:40; display:flex; align-items:center; justify-content:center; color:var(--text); }
.kc-screen.dim { background:rgba(5,8,20,.72); backdrop-filter:blur(4px); }
.kc-card { background:var(--panel2); border:1px solid var(--line); border-radius:14px; padding:22px 26px; box-shadow:0 0 40px rgba(56,232,255,.12); max-height:90vh; overflow:auto; }
.kc-h { margin:0 0 14px; font-size:13px; letter-spacing:.2em; text-transform:uppercase; color:var(--cyan); }
.kc-btn { display:block; width:100%; background:rgba(56,232,255,.08); color:var(--text); border:1px solid var(--cyan); border-radius:8px; padding:11px 18px; font-size:17px; letter-spacing:.06em; cursor:pointer; margin-top:10px; transition:all .15s; font-family:var(--font); }
.kc-btn:hover, .kc-btn:focus-visible { background:var(--cyan); color:#06101e; box-shadow:0 0 18px rgba(56,232,255,.6); outline:none; }
.kc-btn.pink { border-color:var(--pink); background:rgba(255,79,163,.1); } .kc-btn.pink:hover { background:var(--pink); box-shadow:0 0 18px rgba(255,79,163,.6); }
.kc-btn.small { display:inline-block; width:auto; padding:6px 12px; font-size:14px; margin-top:0; }
.kc-btn:disabled { opacity:.4; cursor:not-allowed; }
/* titre */
.kc-title { background:#070b1a; flex-direction:column; text-align:center; overflow:hidden; }
.kc-title canvas { position:absolute; inset:0; width:100%; height:100%; }
.kc-title .in { position:relative; z-index:1; display:flex; flex-direction:column; align-items:center; }
.kc-logo { margin:0; font-size:clamp(54px,11vw,128px); font-weight:900; letter-spacing:.06em; line-height:1; color:#fff; text-shadow:0 0 12px var(--pink),0 0 34px var(--pink),0 0 70px #a0208a; }
.kc-logo span { color:var(--cyan); text-shadow:0 0 12px var(--cyan),0 0 34px var(--cyan),0 0 70px #1090b0; }
.kc-tag { margin:14px 0 34px; font-size:clamp(14px,1.8vw,20px); letter-spacing:.3em; text-transform:uppercase; color:var(--dim); }
.kc-title .menu { width:320px; }
.kc-foot { position:absolute; bottom:14px; left:0; right:0; text-align:center; z-index:1; font-size:12px; color:var(--dim); }
/* sélection de perso */
.kc-sel { background:radial-gradient(ellipse at 50% 20%,#1a2250,#070b1a 70%); flex-direction:column; padding:16px; }
.kc-sel h2 { margin:0 0 4px; font-size:30px; letter-spacing:.14em; text-transform:uppercase; text-shadow:0 0 14px var(--cyan); }
.kc-sel > p { margin:0 0 14px; color:var(--dim); font-size:15px; }
.kc-chars { display:grid; grid-template-columns:repeat(3,minmax(0,300px)); gap:18px; justify-content:center; width:100%; max-height:calc(100vh - 110px); overflow:auto; padding:6px; }
.kc-char { background:var(--panel2); border:2px solid var(--line); border-radius:16px; overflow:hidden; cursor:pointer; transition:all .18s; display:flex; flex-direction:column; text-align:left; color:var(--text); padding:0; font-family:var(--font); }
.kc-char:hover, .kc-char:focus-visible, .kc-char.sel { transform:translateY(-4px); border-color:var(--c); box-shadow:0 0 28px var(--c); outline:none; }
.kc-char .pic { height:min(330px,38vh); background:linear-gradient(180deg,rgba(255,255,255,.05),transparent),radial-gradient(circle at 50% 80%,var(--c),transparent 70%); display:flex; align-items:flex-end; justify-content:center; }
.kc-char .pic img { height:100%; max-width:100%; object-fit:contain; filter:drop-shadow(0 6px 10px rgba(0,0,0,.6)); }
.kc-char .info { padding:12px 16px 14px; flex:1; display:flex; flex-direction:column; }
.kc-char .nm { font-size:19px; font-weight:700; margin:0; min-height:2.5em; display:flex; align-items:center; }
.kc-char .sp { font-size:13px; color:var(--c); letter-spacing:.08em; text-transform:uppercase; margin:2px 0 6px; }
.kc-char .ab { font-size:13px; color:var(--dim); margin:0 0 8px; line-height:1.35; min-height:2.7em; }
.kc-char .ab b { color:var(--text); }
.kc-stat { display:grid; grid-template-columns:78px 1fr 28px; align-items:center; gap:8px; font-size:12px; color:var(--dim); margin-top:4px; }
.kc-stat .bar { height:7px; border-radius:4px; background:rgba(255,255,255,.1); overflow:hidden; } .kc-stat .bar i { display:block; height:100%; background:var(--c); box-shadow:0 0 8px var(--c); }
.kc-char .go { margin-top:auto;  text-align:center; padding:8px; border-radius:8px; background:var(--c); color:#07101e; font-weight:700; letter-spacing:.08em; }
/* chargement */
.kc-load { background:#070b1a; flex-direction:column; text-align:center; z-index:60; }
.kc-load .bar { width:min(520px,70vw); height:8px; border-radius:4px; background:rgba(255,255,255,.1); overflow:hidden; margin:18px 0; } .kc-load .bar i { display:block; height:100%; width:0; background:linear-gradient(90deg,var(--pink),var(--cyan)); transition:width .2s; }
.kc-load .tip { max-width:560px; color:var(--dim); font-size:17px; line-height:1.4; min-height:48px; }
.kc-load h3 { margin:0; font-size:22px; letter-spacing:.2em; text-transform:uppercase; color:var(--cyan); }
/* pause + panneaux */
.kc-pause { width:340px; } .kc-pause h2 { margin:0 0 6px; text-align:center; font-size:26px; letter-spacing:.2em; text-transform:uppercase; }
.kc-set { width:min(520px,92vw); } .kc-row { display:grid; grid-template-columns:1fr 200px; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,.07); font-size:15px; }
.kc-row select, .kc-row input[type=range] { width:100%; } .kc-row select { background:#101834; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:5px; font-family:var(--font); }
.kc-row input[type=checkbox] { width:20px; height:20px; accent-color:var(--cyan); justify-self:end; }
.kc-keys { width:min(640px,94vw); } .kc-keys table { width:100%; border-collapse:collapse; font-size:14px; } .kc-keys td { padding:5px 8px; border-bottom:1px solid rgba(255,255,255,.07); } .kc-keys td:first-child { color:var(--cyan); white-space:nowrap; width:42%; }
.kc-end { flex-direction:column; text-align:center; z-index:45; }
.kc-end h1 { margin:0; font-size:clamp(60px,12vw,140px); letter-spacing:.1em; text-transform:uppercase; animation:kc-pop .6s ease-out; }
.kc-end p { font-size:22px; margin:10px 0; color:var(--text); text-shadow:0 0 8px #000; }
.kc-end.busted { background:repeating-linear-gradient(135deg,rgba(255,40,60,.18) 0 40px,rgba(40,90,255,.18) 40px 80px),rgba(0,0,0,.45); } .kc-end.busted h1 { color:#fff; text-shadow:0 0 30px #ff2a4a,0 0 60px #2a5aff; }
.kc-end.ko { background:radial-gradient(circle,rgba(0,0,0,.2),rgba(0,0,0,.85)); } .kc-end.ko h1 { color:#fff; text-shadow:0 0 30px #fff; }
/* roue de perso */
.kc-wheel { z-index:35; background:rgba(5,8,20,.55); flex-direction:column; pointer-events:none; }
.kc-wheel .ring { display:flex; gap:22px; } .kc-wheel .opt { width:190px; background:var(--panel2); border:2px solid var(--line); border-radius:16px; text-align:center; padding:10px; opacity:.75; transition:all .12s; }
.kc-wheel .opt.sel { opacity:1; border-color:var(--c); box-shadow:0 0 30px var(--c); transform:scale(1.08); } .kc-wheel .opt.cur { border-style:dashed; }
.kc-wheel .opt .pic { height:170px; display:flex; align-items:flex-end; justify-content:center; background:radial-gradient(circle at 50% 90%,var(--c),transparent 70%); border-radius:10px; } .kc-wheel .opt img { height:100%; object-fit:contain; }
.kc-wheel .opt b { display:block; margin-top:6px; } .kc-wheel .opt small { color:var(--dim); } .kc-wheel .help { margin-top:16px; color:var(--dim); font-size:15px; }
/* carte plein écran */
.kc-map { z-index:30; background:rgba(5,8,20,.94); } .kc-map canvas { position:absolute; inset:0; width:100%; height:100%; cursor:crosshair; }
.kc-legend { position:absolute; left:18px; top:18px; width:230px; font-size:13px; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
.kc-legend div { display:flex; align-items:center; gap:8px; margin:5px 0; } .kc-legend i { width:12px; height:12px; border-radius:50%; display:inline-block; }
.kc-map .tools { position:absolute; right:18px; top:18px; display:flex; gap:8px; } .kc-map .info { position:absolute; left:50%; bottom:18px; transform:translateX(-50%); background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 16px; font-size:14px; color:var(--dim); }
/* téléphone */
.kc-phone { z-index:30; justify-content:flex-end; padding-right:40px; background:rgba(5,8,20,.35); }
.kc-ph { width:340px; height:min(640px,88vh); background:#0a0f22; border:3px solid #2a3768; border-radius:34px; box-shadow:0 0 40px rgba(56,232,255,.25); display:flex; flex-direction:column; overflow:hidden; }
.kc-ph .top { display:flex; justify-content:space-between; padding:12px 22px 6px; font-size:13px; color:var(--dim); }
.kc-ph .body { flex:1; overflow:auto; padding:8px 16px 14px; } .kc-ph h3 { margin:6px 0 10px; font-size:18px; color:var(--cyan); letter-spacing:.08em; }
.kc-apps { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; padding-top:10px; } .kc-app { background:none; border:0; color:var(--text); cursor:pointer; text-align:center; font-size:13px; font-family:var(--font); }
.kc-app .ic { width:64px; height:64px; margin:0 auto 6px; border-radius:18px; display:flex; align-items:center; justify-content:center; font-size:28px; background:var(--c); color:#08101e; box-shadow:0 0 16px var(--c); } .kc-app:hover .ic { transform:scale(1.08); }
.kc-item { background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin-bottom:8px; font-size:14px; } .kc-item b { display:block; font-size:15px; } .kc-item small { color:var(--dim); display:block; margin:3px 0 6px; line-height:1.3; }
.kc-chip { display:inline-block; font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,.1); margin-left:6px; } .kc-chip.done { background:rgba(123,245,154,.2); color:var(--green); } .kc-chip.available { background:rgba(255,210,63,.2); color:var(--yellow); }
.kc-ph .home { text-align:center; padding:8px; border-top:1px solid var(--line); }
.kc-gal { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; } .kc-gal img { width:100%; border-radius:8px; border:1px solid var(--line); }
.kc-flash { position:absolute; inset:0; background:#fff; z-index:99; animation:kc-fl .35s forwards; pointer-events:none; } @keyframes kc-fl { to { opacity:0; } }
/* boutique */
.kc-shop { width:min(640px,94vw); } .kc-shop .grp { margin:12px 0 6px; color:var(--cyan); font-size:12px; letter-spacing:.16em; text-transform:uppercase; }
.kc-shop .items { display:flex; flex-wrap:wrap; gap:8px; } .kc-sw { min-width:92px; border:1px solid var(--line); background:var(--panel); color:var(--text); border-radius:8px; padding:6px 8px; font-size:12px; cursor:pointer; text-align:center; font-family:var(--font); } .kc-sw:hover:not(:disabled) { border-color:var(--cyan); } .kc-sw:disabled { opacity:.4; } .kc-sw i { display:block; height:22px; border-radius:4px; margin-bottom:4px; border:1px solid rgba(255,255,255,.25); }
.kc-sw.wide { flex:1 1 100%; text-align:left; display:flex; justify-content:space-between; }
@media (max-width:900px) { .kc-chars { grid-template-columns:1fr; } .kc-mini { transform:scale(.8); transform-origin:left bottom; } .kc-phone { padding-right:0; justify-content:center; } }
`;

export function injectStyle() {
  if (document.getElementById('kc-style')) return;
  const s = document.createElement('style');
  s.id = 'kc-style'; s.textContent = CSS;
  document.head.appendChild(s);
}
