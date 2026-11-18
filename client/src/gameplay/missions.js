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
      { type: 'say', text: 'Écoutez Lou.', lines: [L('Lou', 'Inès ! Un colis pour le port, et il ne supporte pas l\'attente. Prends la sportive devant le garage.'), L('Inès', 'Elle a des freins, au moins ?', 3), L('Lou', 'Des freins, des phares et une grosse envie de vivre. Comme toi.', 4)] },
      { type: 'enterVehicle', text: 'Montez dans la voiture de sport.', spawn: { type: 'sport', at: { place: 'garage', dx: 8, dz: 4 } } },
      { type: 'goto', text: 'Livrez le colis au port avant la fin du temps.', to: 'port', vehicle: true, radius: 10, timeLimit: 150, say: [L('Lou', 'Le client attend. Il n\'est pas patient. Ni très poli.')] },
      { type: 'say', text: 'Colis livré.', lines: [L('Client', 'Ce colis contient… un routeur. Un seul routeur. Il clignote bizarrement.'), L('Inès', 'Il clignote en morse ? Non. Laisse tomber.', 3), L('Client', 'Il vient de dire « bonjour » sur mon wifi. Je n\'ai pas de wifi.', 4)] },
    ],
    outro: 'Un routeur qui dit bonjour : Lou risque de vous rappeler très vite.',
  },
  {
    id: 'ines_2', char: 'ines', title: 'Visite non prévue', giver: 'jetee', reward: 600, requires: 'ines_1',
    summary: 'Un paquet livré à la jetée a alerté la police. Semez-la.',
    steps: [
      { type: 'say', text: 'Écoutez Lou.', lines: [L('Lou', 'Inès, le routeur a appelé la police tout seul. Elle arrive à la jetée !'), L('Inès', 'Un routeur qui balance. Charmant.', 3)] },
      { type: 'goto', text: 'Rejoignez la jetée.', to: 'jetee', radius: 12 },
      { type: 'evade', text: 'Semez la police.', level: 2, say: [L('Radio police', 'Toutes les unités : véhicule suspect à la jetée. Il aurait un routeur. Je répète : un routeur.')] },
      { type: 'say', text: 'Vous êtes tranquille.', lines: [L('Inès', 'Ils devraient régler leurs sirènes sur « discret ».', 3), L('Inconnu', 'Joli freinage. Je vous regarde depuis les feux rouges.', 4)] },
    ],
    outro: 'La police est semée. Quelqu\'un vous a pourtant vue : un message sans nom s\'affiche.',
  },
  {
    id: 'ines_3', char: 'ines', title: 'Course contre le Cluster', giver: 'stade', reward: 900, requires: 'ines_2',
    summary: 'Le Cluster défie les pilotes de la ville. Il faut finir première, sinon la course est à refaire.',
    steps: [
      { type: 'say', text: 'Écoutez le message.', lines: [L('Cluster', 'Bravo, Inès. Gagne la course, et je te dirai pour qui roule le routeur.'), L('Inès', 'Très bien. Je gagne, vous parlez.', 3), L('Cluster', 'Les feux resteront verts pour moi. Pas pour toi. Bonne chance.', 4)] },
      { type: 'enterVehicle', text: 'Montez dans la voiture de course.', spawn: { type: 'sport', at: { place: 'stade', dx: 10, dz: 0 } } },
      { type: 'race', text: 'Gagnez la course (première place obligatoire).', mustWin: true, checkpoints: [{ place: 'port' }, { place: 'phare' }, { place: 'belvedere' }, { place: 'stade' }], rivals: [{ name: 'Fanny', speed: 21 }, { name: 'Gégé', speed: 19 }] },
      { type: 'say', text: 'Course gagnée.', lines: [L('Cluster', 'Impressionnant. Le routeur roule pour moi. Évidemment.'), L('Inès', 'Évidemment. Merci pour la réponse, très utile.', 3)] },
    ],
    outro: 'Le Cluster vous attendait sur la ligne d\'arrivée, et il adore parler de lui.',
  },
  // ---------- Malik ----------
  {
    id: 'malik_1', char: 'malik', title: 'Remorquage express', giver: 'garage', reward: 400,
    summary: 'Une camionnette est en panne au belvédère. Ramenez-la au garage de Lou.',
    steps: [
      { type: 'say', text: 'Écoutez Lou.', lines: [L('Lou', 'Malik, une camionnette est en rade au belvédère. Ramène-la ici, elle me fait de la peine.'), L('Malik', 'Elle a une panne, ou des états d\'âme ?', 3)] },
      { type: 'goto', text: 'Allez au belvédère.', to: 'belvedere', radius: 12 },
      { type: 'enterVehicle', text: 'Montez dans la camionnette.', spawn: { type: 'van', at: { place: 'belvedere', dx: 6, dz: 3 } } },
      { type: 'goto', text: 'Ramenez la camionnette au garage.', to: 'garage', vehicle: true, radius: 10, say: [L('Malik', 'La radio marche toute seule. Elle répète « Bonjour, ici le Cluster ». Je baisse le son.', 4)] },
    ],
    outro: 'La camionnette est au garage. Sa radio, elle, n\'a pas arrêté de parler.',
  },
  {
    id: 'malik_2', char: 'malik', title: 'La pièce rare', giver: 'garage', reward: 550, requires: 'malik_1',
    summary: 'Un carburateur d\'époque attend à l\'aéroport. Rapportez-le en moins de trois minutes.',
    steps: [
      { type: 'goto', text: 'Allez à l\'aéroport en voiture.', to: 'aeroport', vehicle: true, radius: 14, say: [L('Lou', 'Le transporteur ne reste pas longtemps. Dépêche-toi, il a un avion à rater.')] },
      { type: 'wait', text: 'Chargez la pièce…', seconds: 3, say: [L('Malik', 'Elle est plus lourde que prévu. Ou alors je vieillis.', 3)] },
      { type: 'goto', text: 'Rapportez la pièce au garage.', to: 'garage', vehicle: true, radius: 10, timeLimit: 180, say: [L('Malik', 'Il y a une puce wifi collée sous le carburateur. Le même logo qu\'au routeur.', 4)] },
    ],
    outro: 'Une puce wifi cachée dans un carburateur : le Cluster se mêle même de mécanique.',
  },
  {
    id: 'malik_3', char: 'malik', title: 'Vigiles en roue libre', giver: 'stade', reward: 750, requires: 'malik_2',
    summary: 'Des agents de sécurité du Cluster protègent une antenne. Mettez-les K.O. (sans bobo) et photographiez-la.',
    steps: [
      { type: 'say', text: 'Écoutez Lou.', lines: [L('Lou', 'Les vigiles du stade protègent une antenne louche. Calme-les. Gentiment.'), L('Malik', 'Je vais leur proposer un café. Avec une clé à molette.', 3)] },
      { type: 'goto', text: 'Allez au stade.', to: 'stade', radius: 14 },
      { type: 'ko', text: 'Mettez K.O. les vigiles.', count: 3, at: 'stade' },
      { type: 'photo', text: 'Photographiez l\'antenne avec le téléphone (touche P).', at: 'stade', radius: 80 },
      { type: 'say', text: 'Antenne photographiée.', lines: [L('Malik', 'Photo prise. L\'antenne a l\'air vexée.', 3), L('Cluster', 'Vous venez de frapper mes employés. Ils étaient très attachés à leur poste.', 4)] },
    ],
    outro: 'Trois vigiles endormis, une antenne en photo, et un Cluster qui boude.',
  },
  // ---------- Jade ----------
  {
    id: 'jade_1', char: 'jade', title: 'Signal faible', giver: 'mairie', reward: 450,
    summary: 'Une antenne inconnue émet depuis la mairie. Prenez-la en photo.',
    steps: [
      { type: 'say', text: 'Écoutez.', lines: [L('Jade', 'Un signal chiffré part de la mairie toutes les 7 minutes. Pile. Comme une cantine.'), L('Jade', 'Je veux voir l\'antenne. Et le menu.', 3)] },
      { type: 'goto', text: 'Allez à la mairie.', to: 'mairie', radius: 14 },
      { type: 'photo', text: 'Photographiez l\'antenne (touche P, appareil photo).', at: 'mairie', radius: 80 },
      { type: 'say', text: 'Analysez la photo.', lines: [L('Jade', 'Pas de marque. Pas de câble. Juste un petit logo : un cube dans un cube.', 4), L('Jade', 'Le Cluster a de l\'humour. Ou un graphiste.', 3)] },
    ],
    outro: 'Un cube dans un cube : la signature du Cluster.',
  },
  {
    id: 'jade_2', char: 'jade', title: 'Sur écoute', giver: 'mairie', reward: 600, requires: 'jade_1',
    summary: 'Un coursier du Cluster traverse la ville. Suivez-le sans vous faire repérer.',
    steps: [
      { type: 'say', text: 'Écoutez.', lines: [L('Jade', 'Un coursier part du port avec un disque dur. Je veux savoir où il va.'), L('Jade', 'Reste à distance : il est discret, mais il a des yeux dans les caméras.', 4)] },
      { type: 'goto', text: 'Rejoignez le port.', to: 'port', radius: 16 },
      { type: 'follow', text: 'Suivez le coursier à distance raisonnable.', from: 'port', to: 'mairie', speed: 6, maxGap: 40, patience: 14, say: [L('Jade', 'Il marche vite pour quelqu\'un qui transporte des secrets.', 3)] },
      { type: 'say', text: 'Le coursier est arrivé.', lines: [L('Jade', 'Il entre à la mairie par la porte de service. Avec le disque dur.', 4), L('Jade', 'Le disque porte une étiquette : « sauvegarde du datacenter, zone industrielle, portail sud ». Merci pour l\'adresse.', 5)] },
    ],
    outro: 'Le coursier a livré la sauvegarde. Le datacenter du Cluster se cache dans la zone industrielle.',
  },
  {
    id: 'jade_3', char: 'jade', title: 'Brouillage', giver: 'commissariat', reward: 800, requires: 'jade_2',
    summary: 'Attirez l\'attention de la police, puis disparaissez grâce à la Panne de réseau (touche G).',
    steps: [
      { type: 'say', text: 'Écoutez.', lines: [L('Jade', 'Pour entrer dans le datacenter, il faut que la police regarde ailleurs. Je leur offre un peu de spectacle.')] },
      { type: 'goto', text: 'Allez devant le commissariat.', to: 'commissariat', radius: 14 },
      { type: 'evade', text: 'Faites-vous remarquer, puis semez la police (G : Panne de réseau).', level: 3, say: [L('Jade', 'Si ça chauffe, active la Panne de réseau avec G. Les feux seront verts, la police aveugle.')] },
      { type: 'say', text: 'Vous avez disparu.', lines: [L('Jade', 'Plus un agent à l\'horizon. Les caméras du coin sont aveugles pour dix minutes.', 4)] },
    ],
    outro: 'La voie est libre : direction le casse du datacenter, dans la zone industrielle.',
  },
  // ---------- Mission finale ----------
  {
    id: 'finale', char: null, title: 'Le casse du datacenter', giver: 'mairie', reward: 3000, requires: ['ines_3', 'malik_3', 'jade_3'],
    summary: 'Les trois équipiers s\'infiltrent dans le datacenter du Cluster. Le changement de perso est imposé à chaque phase.',
    steps: [
      { type: 'switch', text: 'Jade prend le contrôle.', to: 'jade' },
      { type: 'say', text: 'Briefing de Jade.', lines: [L('Jade', 'Plan : je coupe les caméras, Inès nous sort de là, Malik remet le serveur central en état. Simple.'), L('Malik', 'Quand quelqu\'un dit « simple », je prends ma clé à molette.', 3)] },
      { type: 'goto', text: 'Jade : atteignez le datacenter (zone industrielle, repérez les baies lumineuses).', to: 'datacenter', radius: 14 },
      { type: 'wait', text: 'Jade : piratage des caméras…', seconds: 6, say: [L('Jade', 'Pare-feu… cassé. Caméras… aveugles. Le Cluster boude.')] },
      { type: 'switch', text: 'Inès prend le volant.', to: 'ines' },
      { type: 'enterVehicle', text: 'Inès : montez dans la voiture de fuite.', spawn: { type: 'sport', at: { place: 'datacenter', dx: 12, dz: 6 } } },
      { type: 'goto', text: 'Inès : amenez la voiture à l\'entrée du datacenter.', to: 'datacenter', vehicle: true, radius: 10, timeLimit: 200, say: [L('Inès', 'Voiture de fuite avancée. Ça me change de la voiture de livraison.', 4)] },
      { type: 'switch', text: 'Malik prend la relève.', to: 'malik' },
      { type: 'goto', text: 'Malik : rejoignez la salle des serveurs (porte du hall).', to: { place: 'datacenter', dx: 0, dz: -13 }, radius: 6 },
      { type: 'wait', text: 'Malik : réparation du serveur central…', seconds: 6, say: [L('Malik', 'Un petit coup de clé, un gros coup de chance.')] },
      { type: 'switch', text: 'Retour à Jade pour la fuite.', to: 'jade' },
      { type: 'evade', text: 'Jade : l\'alarme est déclenchée, semez la police !', level: 3, say: [L('Cluster', 'Intrusion détectée. Je vous vois. Je vous vois tous.')] },
      { type: 'say', text: 'Fin de la mission.', lines: [L('Jade', 'Le Cluster est à genoux. Enfin… à quatre-vingt-dix pour cent.'), L('Inès', 'Le reste, c\'est pour la suite.', 3), L('Cluster', 'Un pod est tombé. Un autre l\'a déjà remplacé. À très bientôt, Kube City.', 5)] },
    ],
    outro: 'Le datacenter est hors service. Le Cluster promet de revenir : la ville est à vous, en attendant.',
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
