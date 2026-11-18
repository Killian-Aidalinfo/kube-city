// Interface minimale du combat : roue d'armes (ralenti), réticule et marqueur de touche. DOM léger, en français.
import { WEAPONS, WEAPON_ORDER } from './logic.js';

const CSS = `
#kc-wheel{position:fixed;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none;z-index:40;font-family:system-ui,sans-serif}
#kc-wheel.on{display:flex;background:radial-gradient(circle,rgba(10,10,30,.35),rgba(10,10,30,.7))}
#kc-wheel .ring{position:relative;width:300px;height:300px}
#kc-wheel .w{position:absolute;width:110px;height:78px;margin:-39px 0 0 -55px;border:2px solid #7df9ff;border-radius:14px;background:rgba(15,20,45,.8);color:#cfe;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:13px;box-shadow:0 0 12px #7df9ff55;transition:transform .08s}
#kc-wheel .w b{font-size:26px;line-height:1.1}
#kc-wheel .w.sel{transform:scale(1.18);border-color:#ff4fa3;box-shadow:0 0 22px #ff4fa3;color:#fff}
#kc-wheel .c{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;text-align:center;font-size:15px}
#kc-reticle{position:fixed;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border:2px solid #fff;border-radius:50%;opacity:0;pointer-events:none;z-index:30;transition:opacity .1s,border-color .1s,transform .1s;box-shadow:0 0 6px #000a}
#kc-reticle::after{content:'';position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#ff4fa3;border-radius:50%}
#kc-reticle.on{opacity:.95}
#kc-reticle.hit{border-color:#ff4fa3;transform:scale(1.35)}
`;

export function createCombatUI() {
  if (typeof document === 'undefined') return { show() {}, hide() {}, reticle() {}, hitMarker() {}, enabled: false };
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const wheel = document.createElement('div'); wheel.id = 'kc-wheel';
  const ring = document.createElement('div'); ring.className = 'ring';
  const centre = document.createElement('div'); centre.className = 'c';
  const pos = [[150, 40], [260, 150], [150, 260], [40, 150]];
  const nodes = WEAPON_ORDER.map((id, i) => {
    const el = document.createElement('div'); el.className = 'w';
    el.style.left = pos[i][0] + 'px'; el.style.top = pos[i][1] + 'px';
    el.innerHTML = `<b>${WEAPONS[id].icon}</b>${WEAPONS[id].label}`;
    ring.appendChild(el); return el;
  });
  ring.appendChild(centre); wheel.appendChild(ring);
  const ret = document.createElement('div'); ret.id = 'kc-reticle';
  document.body.append(wheel, ret);
  let hitT = 0;
  return {
    enabled: true,
    show(sel) { wheel.classList.add('on'); nodes.forEach((n, i) => n.classList.toggle('sel', i === sel)); centre.textContent = sel >= 0 ? WEAPONS[WEAPON_ORDER[sel]].label : 'Armes'; },
    hide() { wheel.classList.remove('on'); },
    reticle(on) { ret.classList.toggle('on', on); },
    hitMarker() { ret.classList.add('hit'); clearTimeout(hitT); hitT = setTimeout(() => ret.classList.remove('hit'), 130); },
  };
}
