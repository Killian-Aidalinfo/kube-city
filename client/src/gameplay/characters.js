// Les trois persos jouables (originaux) : données, capacités et progression des statistiques. Module pur.

/** Valeur max d'une statistique. */
export const STAT_MAX = 10;

export const CHARACTERS = {
  ines: {
    id: 'ines', name: 'Inès « Turbo » Moreau', short: 'Inès', specialty: 'Ancienne pilote de rallye',
    bio: 'A raccroché le casque pour livrer des colis… à 180 km/h. Elle n\'a jamais vu un feu rouge qu\'elle ne trouve négociable.',
    stats: { endurance: 5, conduite: 9, combat: 4 },
    ability: { id: 'focus', name: 'Focus', desc: 'Ralentit le temps en conduite. Jauge qui se recharge.', cost: 0.5, duration: 4, cooldown: 12 },
    activity: 'Inès règle ses amortisseurs près du port.',
    defaultOutfit: { skin: '#e0ac8a', hair: '#2b1b14', top: '#d4513f', bottom: '#23283b', shoes: '#f2f2f2' },
    hideout: /ines/i, offset: { x: 18, z: 12 },
  },
  malik: {
    id: 'malik', name: 'Malik « Clé à molette » Benali', short: 'Malik', specialty: 'Mécano du garage de Lou',
    bio: 'Répare tout ce qui roule et la plupart de ce qui ne roule plus. Ses voitures encaissent mieux les chocs que ses blagues.',
    stats: { endurance: 7, conduite: 6, combat: 6 },
    ability: { id: 'repair', name: 'Réparation express', desc: 'Répare le véhicule courant en un éclair.', cost: 0.6, duration: 0, cooldown: 20 },
    activity: 'Malik remonte un moteur dans l\'atelier de Lou.',
    defaultOutfit: { skin: '#8d5a3c', hair: '#111111', top: '#2f6fb3', bottom: '#5b4a33', shoes: '#2b2b2b' },
    hideout: /malik/i, offset: { x: -16, z: 14 },
    /** Multiplicateur de dégâts subis par ses véhicules. */
    vehicleDamage: 0.6,
  },
  jade: {
    id: 'jade', name: 'Jade Okafor', short: 'Jade', specialty: 'Hackeuse',
    bio: 'Elle parle aux feux tricolores et ils lui répondent. Elle cherche qui est derrière le « Cluster » qui contrôle la ville.',
    stats: { endurance: 4, conduite: 5, combat: 6 },
    ability: { id: 'blackout', name: 'Panne de réseau', desc: 'Feux au vert pour elle, police brouillée quelques secondes.', cost: 0.7, duration: 8, cooldown: 25 },
    activity: 'Jade pirate une borne Wi-Fi sur la place du Centre.',
    defaultOutfit: { skin: '#5a3a28', hair: '#6b2fa0', top: '#2a2a2a', bottom: '#3b8f6a', shoes: '#d4d43f' },
    hideout: /jade/i, offset: { x: 4, z: -20 },
  },
};
export const CHARACTER_IDS = Object.keys(CHARACTERS);

/** Fait progresser une statistique (retourne la nouvelle valeur plafonnée). */
export function gainStat(stats, key, amount) {
  if (!(key in stats)) return 0;
  stats[key] = Math.min(STAT_MAX, +(stats[key] + amount).toFixed(4));
  return stats[key];
}

/** Succès : id, titre, condition sur le profil global. */
export const ACHIEVEMENTS = [
  { id: 'first_mission', title: 'Première mission', test: (p) => countDone(p) >= 1 },
  { id: 'all_missions', title: 'Tout Kube City sous contrôle', test: (p) => countDone(p) >= 9 },
  { id: 'kubes_10', title: 'Chasseur de kubes', test: (p) => p.kubes.length >= 10 },
  { id: 'kubes_50', title: 'Collection complète', test: (p) => p.kubes.length >= 50 },
  { id: 'jumps_10', title: 'Cascadeur', test: (p) => p.stats.jumps >= 10 },
  { id: 'wanted_5', title: 'Ennemi public', test: (p) => p.stats.maxWanted >= 5 },
  { id: 'distance_20', title: 'Globe-trotter (20 km)', test: (p) => p.stats.distance >= 20000 },
  { id: 'rich', title: 'Premier millier', test: (p) => Object.values(p.chars).reduce((s, c) => s + c.money, 0) >= 5000 },
];
const countDone = (p) => Object.values(p.missions).filter((m) => m.done).length;

/** Renvoie les succès nouvellement obtenus (et les marque). */
export function checkAchievements(profile) {
  const got = [];
  for (const a of ACHIEVEMENTS) if (!profile.achievements[a.id] && a.test(profile)) { profile.achievements[a.id] = true; got.push(a); }
  return got;
}
