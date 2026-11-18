// Missions de Kube City, décrites en données (voir runner.js pour les types d'objectifs).
// Les lieux sont désignés par des clés logiques résolues par gameplay/index.js (garage, port, jetee, mairie…).
// Fil narratif : un mystérieux « Cluster » contrôle les feux, les caméras et le wifi de la ville.

const L = (speaker, text, dur = 4) => ({ speaker, text, dur });

export const MISSIONS = [
  // ---------- Inès ----------
  {
    id: 'ines_1', char: 'ines', title: 'Colis à 180 km/h', giver: 'garage', reward: 450,
    summary: 'Lou a un colis urgent pour le port. Vite, et sans rayer la carrosserie.',
    steps: [
      { type: 'say', text: 'Écoutez Lou.', lines: [L('Lou', 'Inès ! J\'ai un colis pour le port, et il ne supporte pas l\'attente. Prends la sportive devant le garage.'), L('Inès', 'Elle a des freins, au moins ?', 3)] },
      { type: 'enterVehicle', text: 'Montez dans la voiture de sport.', spawn: { type: 'sport', at: { place: 'garage', dx: 8, dz: 4 } } },
      { type: 'goto', text: 'Livrez le colis au port avant la fin du temps.', to: 'port', vehicle: true, radius: 10, timeLimit: 150, say: [L('Lou', 'Le client attend. Il n\'est pas patient. Ni très poli.')] },
      { type: 'say', text: 'Colis livré.', lines: [L('Client', 'Ce colis contient… ah. Un routeur. Un seul routeur. Il clignote bizarrement.'), L('Inès', 'Il clignote en morse ? Non. Laisse tomber.', 3)] },
    ],
  },
  {
    id: 'ines_2', char: 'ines', title: 'Visite non prévue', giver: 'jetee', reward: 600, requires: 'ines_1',
    summary: 'Un paquet livré à la jetée a alerté la police. Semez-la.',
    steps: [
      { type: 'say', text: 'Écoutez Lou.', lines: [L('Lou', 'Inès, le routeur a déclenché une alarme. La police arrive à la jetée !')] },
      { type: 'goto', text: 'Rejoignez la jetée.', to: 'jetee', radius: 12 },
      { type: 'evade', text: 'Semez la police.', level: 2, say: [L('Radio police', 'Toutes les unités, un véhicule suspect à la jetée.')] },
      { type: 'say', text: 'Vous êtes tranquille.', lines: [L('Inès', 'Ils devraient régler leurs sirènes sur « discret ».', 3)] },
    ],
  },
  {
    id: 'ines_3', char: 'ines', title: 'Course contre le Cluster', giver: 'stade', reward: 900, requires: 'ines_2',
    summary: 'Le Cluster défie les pilotes de la ville. Gagnez la course des Docks.',
    steps: [
      { type: 'say', text: 'Écoutez le message.', lines: [L('Inconnu', 'Bravo, Inès. Gagne la course, et je te dirai pour qui roule le routeur.'), L('Inès', 'Très bien. Je gagne, vous parlez.', 3)] },
      { type: 'enterVehicle', text: 'Montez dans la voiture de course.', spawn: { type: 'sport', at: { place: 'stade', dx: 10, dz: 0 } } },
      { type: 'race', text: 'Gagnez la course.', checkpoints: [{ place: 'port' }, { place: 'phare' }, { place: 'belvedere' }, { place: 'stade' }], rivals: [{ name: 'Fanny', speed: 21 }, { name: 'Gégé', speed: 19 }] },
    ],
  },
  // ---------- Malik ----------
  {
    id: 'malik_1', char: 'malik', title: 'Remorquage express', giver: 'garage', reward: 400,
    summary: 'Une camionnette est en panne au belvédère. Ramenez-la au garage de Lou.',
    steps: [
      { type: 'say', text: 'Écoutez Lou.', lines: [L('Lou', 'Malik, une camionnette est en rade au belvédère. Ramène-la ici, elle me fait de la peine.')] },
      { type: 'goto', text: 'Allez au belvédère.', to: 'belvedere', radius: 12 },
      { type: 'enterVehicle', text: 'Montez dans la camionnette.', spawn: { type: 'van', at: { place: 'belvedere', dx: 6, dz: 3 } } },
      { type: 'goto', text: 'Ramenez-la au garage.', to: 'garage', vehicle: true, radius: 10 },
    ],
  },
  {
    id: 'malik_2', char: 'malik', title: 'La pièce rare', giver: 'garage', reward: 550, requires: 'malik_1',
    summary: 'Un carburateur d\'époque attend à l\'aéroport. Rapportez-le en moins de trois minutes.',
    steps: [
      { type: 'goto', text: 'Allez à l\'aéroport en voiture.', to: 'aeroport', vehicle: true, radius: 14, say: [L('Lou', 'Le transporteur ne reste pas longtemps. Dépêche-toi.')] },
      { type: 'wait', text: 'Chargez la pièce…', seconds: 3, say: [L('Malik', 'Elle est plus lourde que prévu. Ou alors je vieillis.', 3)] },
      { type: 'goto', text: 'Rapportez la pièce au garage.', to: 'garage', vehicle: true, radius: 10, timeLimit: 180 },
    ],
  },
  {
    id: 'malik_3', char: 'malik', title: 'Vigiles en roue libre', giver: 'stade', reward: 750, requires: 'malik_2',
    summary: 'Des agents de sécurité du Cluster protègent une antenne. Mettez-les K.O. (sans bobo) et photographiez-la.',
    steps: [
      { type: 'say', text: 'Écoutez Lou.', lines: [L('Lou', 'Les vigiles du stade protègent une antenne louche. Calme-les. Gentiment.')] },
      { type: 'goto', text: 'Allez au stade.', to: 'stade', radius: 14 },
      { type: 'ko', text: 'Mettez K.O. les vigiles.', count: 3, at: 'stade' },
      { type: 'photo', text: 'Photographiez l\'antenne avec le téléphone (touche P).', at: 'stade', radius: 80 },
    ],
  },
  // ---------- Jade ----------
  {
    id: 'jade_1', char: 'jade', title: 'Signal faible', giver: 'mairie', reward: 450,
    summary: 'Une antenne inconnue émet depuis la mairie. Prenez-la en photo.',
    steps: [
      { type: 'say', text: 'Écoutez.', lines: [L('Jade', 'Un signal chiffré part de la mairie toutes les 7 minutes. Je veux voir l\'antenne.')] },
      { type: 'goto', text: 'Allez à la mairie.', to: 'mairie', radius: 14 },
      { type: 'photo', text: 'Photographiez l\'antenne (touche P, appareil photo).', at: 'mairie', radius: 80 },
      { type: 'say', text: 'Analysez la photo.', lines: [L('Jade', 'Pas de marque. Pas de câble. Juste un petit logo : un cube dans un cube.', 4)] },
    ],
  },
  {
    id: 'jade_2', char: 'jade', title: 'Sur écoute', giver: 'mairie', reward: 600, requires: 'jade_1',
    summary: 'Un coursier du Cluster traverse la ville. Suivez-le sans vous faire repérer.',
    steps: [
      { type: 'say', text: 'Écoutez.', lines: [L('Jade', 'Un coursier part du port avec un disque dur. Je veux savoir où il va.')] },
      { type: 'goto', text: 'Rejoignez le port.', to: 'port', radius: 16 },
      { type: 'follow', text: 'Suivez le coursier à distance raisonnable.', from: 'port', to: 'mairie', speed: 6, maxGap: 40, patience: 14 },
      { type: 'say', text: 'Le coursier est arrivé.', lines: [L('Jade', 'Il entre dans le datacenter de la zone industrielle. Voilà un bon endroit pour un Cluster.', 4)] },
    ],
  },
  {
    id: 'jade_3', char: 'jade', title: 'Brouillage', giver: 'commissariat', reward: 800, requires: 'jade_2',
    summary: 'Attirez l\'attention de la police, puis disparaissez grâce à la Panne de réseau (touche G).',
    steps: [
      { type: 'say', text: 'Écoutez.', lines: [L('Jade', 'Pour entrer dans le datacenter, il faut que la police regarde ailleurs. Je leur offre un peu de spectacle.')] },
      { type: 'goto', text: 'Allez devant le commissariat.', to: 'commissariat', radius: 14 },
      { type: 'evade', text: 'Faites-vous remarquer, puis semez la police (G : Panne de réseau).', level: 3, say: [L('Jade', 'Si ça chauffe, active la Panne de réseau avec G.')] },
    ],
  },
  // ---------- Mission finale ----------
  {
    id: 'finale', char: null, title: 'Le casse du datacenter', giver: 'mairie', reward: 3000, requires: ['ines_3', 'malik_3', 'jade_3'],
    summary: 'Les trois équipiers s\'infiltrent dans le datacenter du Cluster. Le changement de perso est imposé à chaque phase.',
    steps: [
      { type: 'switch', text: 'Jade prend le contrôle.', to: 'jade' },
      { type: 'say', text: 'Briefing de Jade.', lines: [L('Jade', 'Plan : je coupe les caméras, Inès nous sort de là, Malik remet le serveur central en état. Simple.'), L('Malik', 'Quand quelqu\'un dit « simple », je prends ma clé à molette.', 3)] },
      { type: 'goto', text: 'Jade : atteignez le datacenter.', to: 'datacenter', radius: 14 },
      { type: 'wait', text: 'Jade : piratage des caméras…', seconds: 6, say: [L('Jade', 'Pare-feu… cassé. Caméras… aveugles. Le Cluster boude.')] },
      { type: 'switch', text: 'Inès prend le volant.', to: 'ines' },
      { type: 'enterVehicle', text: 'Inès : montez dans la voiture de fuite.', spawn: { type: 'sport', at: { place: 'datacenter', dx: 12, dz: 6 } } },
      { type: 'goto', text: 'Inès : amenez la voiture à l\'entrée du datacenter.', to: 'datacenter', vehicle: true, radius: 10, timeLimit: 200 },
      { type: 'switch', text: 'Malik prend la relève.', to: 'malik' },
      { type: 'goto', text: 'Malik : rejoignez la salle des serveurs.', to: { place: 'datacenter', dx: -10, dz: -8 }, radius: 6 },
      { type: 'wait', text: 'Malik : réparation du serveur central…', seconds: 6, say: [L('Malik', 'Un petit coup de clé, un gros coup de chance.')] },
      { type: 'switch', text: 'Retour à Jade pour la fuite.', to: 'jade' },
      { type: 'evade', text: 'Jade : l\'alarme est déclenchée, semez la police !', level: 3, say: [L('Cluster', 'Intrusion détectée. Je vous vois. Je vous vois tous.')] },
      { type: 'say', text: 'Fin de la mission.', lines: [L('Jade', 'Le Cluster est à genoux. Enfin… à quatre-vingt-dix pour cent.'), L('Inès', 'Le reste, c\'est pour la suite.', 3)] },
    ],
  },
];

/** Missions disponibles : non terminées et dont les prérequis sont faits. */
export function availableMissions(done, charId, all = MISSIONS) {
  return all.filter((m) => {
    if (done[m.id]?.done) return false;
    if (m.char && m.char !== charId && m.id !== 'finale') return false;
    const req = [].concat(m.requires || []);
    return req.every((r) => done[r]?.done);
  });
}
