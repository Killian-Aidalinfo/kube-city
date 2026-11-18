// Bus d'événements minimal. Les types et payloads sont documentés dans events.js.
export class Bus {
  constructor() { this.map = new Map(); }
  /** Abonne fn au type ; renvoie une fonction de désabonnement. */
  on(type, fn) {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }
  /** Abonnement unique. */
  once(type, fn) {
    const off = this.on(type, (p) => { off(); fn(p); });
    return off;
  }
  off(type, fn) { this.map.get(type)?.delete(fn); }
  /** Émet un événement ; une erreur dans un écouteur n'interrompt pas les autres. */
  emit(type, payload) {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { console.error(`[bus] écouteur de « ${type} » :`, e); }
    }
  }
}
