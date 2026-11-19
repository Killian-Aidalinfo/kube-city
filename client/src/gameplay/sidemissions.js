// Missions secondaires répétables à thème infra (courtes, 3 à 5 minutes). Construites à la volée pour varier les lieux.
// `ctx` : { me, place(ref), pick(near, minD, maxD) → {x,z}, dist(a,b), time(meters) }.
const L = (speaker, text, dur = 4) => ({ speaker, text, dur });

export const SIDE_MISSIONS = [
  { id: 'rolling', title: 'Rolling update', summary: 'Livrez 3 caisses de la v2 sans jamais laisser l\'entrepôt vide.' },
  { id: 'chaos', title: 'Chaos Monkey', summary: 'Un singe a volé une voiture de police. Rattrapez-le.' },
  { id: 'dns', title: 'Le DNS, c\'est toujours le DNS', summary: 'Un taxi vers des adresses qui changent en route.' },
];

export function buildSideMission(kind, ctx) {
  const { me, pick, dist, time } = ctx;
  if (kind === 'rolling') {
    const depot = ctx.place('port');
    const clients = [];
    let from = depot;
    for (let i = 0; i < 3; i++) { from = pick(depot, 120, 320); clients.push({ x: from.x, z: from.z }); }
    const names = ['la boulangerie', 'le salon de coiffure', 'la mairie annexe'];
    const steps = [
      { type: 'goto', text: 'Rejoignez l\'entrepôt du port (en voiture).', to: depot, vehicle: true, radius: 12, say: [L('Lou', 'Rolling update : on remplace les caisses une par une. Si l\'entrepôt est vide, la ville n\'a plus de service. Et moi plus de clients.')] },
    ];
    clients.forEach((c, i) => {
      const len = dist(depot, c), lim = time(len) + 15;
      steps.push({ type: 'goto', text: `Caisse ${i + 1}/3 : livrez la v2 à ${names[i]}.`, to: c, vehicle: true, radius: 10, timeLimit: lim, failText: 'L\'entrepôt est vide : le service est tombé !',
        say: [L('Lou', i === 0 ? 'Première caisse chargée. Il en reste deux en stock : ne traîne pas.' : i === 1 ? 'Stock à moitié plein. Pour un ingénieur, il est à moitié vide.' : 'Dernière caisse. Après, on pourra dire « zéro indisponibilité ».')] });
      if (i < 2) steps.push({ type: 'goto', text: 'Retournez à l\'entrepôt chercher la caisse suivante.', to: depot, vehicle: true, radius: 12, timeLimit: lim, failText: 'L\'entrepôt est resté vide trop longtemps : le service est tombé !' });
    });
    steps.push({ type: 'say', text: 'Mise à jour terminée.', lines: [L('Lou', 'Trois caisses, zéro coupure. Le Cluster n\'a rien vu.'), L('Cluster', 'J\'ai pourtant tout surveillé. Qui a validé cette mise en production ?', 4)] });
    return { id: 'rolling', title: 'Rolling update', summary: 'Livrez sans vider l\'entrepôt.', reward: 0, steps, onPass: () => ({ reward: 520, text: 'Mise à jour sans coupure : 520 €' }) };
  }
  if (kind === 'chaos') {
    const a = pick(me, 150, 320), b = pick(a, 250, 450);
    return {
      id: 'chaos', title: 'Chaos Monkey', summary: 'Rattrapez le singe.', reward: 0,
      steps: [
        { type: 'say', text: 'Écoutez le commissariat.', lines: [L('Commissariat', 'Un singe a volé une voiture de police. Il fait des tests de résistance sur nos feux rouges.'), L('Commissariat', 'Il dit que c\'est « pour la résilience ». Rattrapez-le.', 4)] },
        { type: 'goto', text: 'Rejoignez la dernière position du singe (en voiture).', to: a, vehicle: true, radius: 25 },
        { type: 'chase', text: 'Rattrapez la voiture de police volée (approchez-vous !).', from: a, to: b, speed: 10, radius: 10, timeLimit: 180, failText: 'Le singe vous a semé. Il a coupé le courant en partant.', spawn: { type: 'police' },
          say: [L('Singe', 'Ouh ouh ! (Traduction : « arrêtez de me poursuivre, je suis en production. »)', 4)] },
        { type: 'say', text: 'Singe attrapé.', lines: [L('Singe', 'Ouh. (Il rend les clés contre une banane.)', 3), L('Commissariat', 'Voiture récupérée. Un seul feu tricolore a survécu. Merci.', 4)] },
      ],
      onPass: () => ({ reward: 480, text: 'Singe attrapé : 480 €' }),
    };
  }
  if (kind === 'dns') {
    const a = pick(me, 60, 200);
    const stops = [];
    let from = a;
    for (let i = 0; i < 3; i++) { from = pick(from, 220, 420); stops.push({ x: from.x, z: from.z }); }
    const len = dist(a, stops[0]) + dist(stops[0], stops[1]) + dist(stops[1], stops[2]);
    return {
      id: 'dns', title: 'Le DNS, c\'est toujours le DNS', summary: 'Adresses mouvantes.', reward: 0,
      steps: [
        { type: 'goto', text: 'Récupérez le client (en voiture).', to: a, vehicle: true, radius: 9, say: [L('Central taxi', 'Un client attend. Il n\'a pas d\'adresse fixe. Il dit que ça « se propage ».')] },
        { type: 'reroute', text: 'Conduisez le client à son adresse.', stops, radius: 10, switchDist: 70, timeLimit: time(len) + 90, failText: 'Le client est descendu : « adresse introuvable, NXDOMAIN ».',
          lines: [L('Client', 'Finalement c\'est ailleurs ! Le TTL de mon adresse a expiré.'), L('Client', 'Encore changé. Ma résolution est instable, je vous promets que c\'est la dernière.', 5)],
          say: [L('Client', 'Direction ma première adresse. Si elle bouge, n\'accusez pas le DNS. C\'est toujours le DNS, mais n\'en parlez pas.', 5)] },
        { type: 'say', text: 'Course terminée.', lines: [L('Client', 'C\'est ici ! Enfin, c\'était ici. Peu importe. Le cache sera vidé demain.', 4), L('Cluster', 'J\'ai tout redirigé. Vous avez l\'air perdu. C\'est normal : c\'était le plan.', 4)] },
      ],
      onPass: () => ({ reward: 430, text: 'Course DNS : 430 €' }),
    };
  }
  return null;
}
