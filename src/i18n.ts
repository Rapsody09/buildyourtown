/**
 * Two languages, one flat dictionary: key -> [français, english].
 * `t()` falls back to the key itself so a missing entry is visible, never fatal.
 */
export type Lang = 'fr' | 'en';

const LANG_KEY = 'citybuilder.lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch { /* no storage */ }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export let lang: Lang = typeof navigator === 'undefined' ? 'fr' : detect();

export function setLang(l: Lang): void {
  lang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch { /* no storage */ }
}

export function hasSavedLang(): boolean {
  try { return localStorage.getItem(LANG_KEY) !== null; } catch { return false; }
}

const D: Record<string, [string, string]> = {
  // ---- generic
  'zone.3': ['Résidentiel', 'Residential'],
  'zone.4': ['Commercial', 'Commercial'],
  'zone.5': ['Industriel', 'Industrial'],
  'dept.police': ['Police', 'Police'],
  'dept.fire': ['Pompiers', 'Fire department'],
  'dept.education': ['Éducation', 'Education'],
  'dept.health': ['Santé', 'Health'],
  'map.none': ['Aucune', 'None'],
  'map.pollution': ['Pollution', 'Pollution'],
  'map.crime': ['Criminalité', 'Crime'],
  'map.landValue': ['Valeur foncière', 'Land value'],
  'map.traffic': ['Trafic', 'Traffic'],
  'map.power': ['Électricité', 'Power'],
  'map.water': ['Eau', 'Water'],
  'map.police': ['Couverture police', 'Police coverage'],
  'map.fire': ['Couverture pompiers', 'Fire coverage'],
  'map.education': ['Couverture scolaire', 'School coverage'],
  'map.health': ['Couverture hospitalière', 'Hospital coverage'],
  'disaster.fire': ['Incendie', 'Fire'],
  'disaster.flood': ['Inondation', 'Flood'],
  'disaster.tornado': ['Tornade', 'Tornado'],
  'disaster.quake': ['Séisme', 'Earthquake'],
  'ord.watch': ['Voisins vigilants', 'Neighbourhood watch'],
  'ord.watch.desc': ['Criminalité −20 %.', 'Crime −20%.'],
  'ord.cleanAir': ['Contrôle des émissions', 'Emission control'],
  'ord.cleanAir.desc': ['Pollution industrielle −30 %, demande industrielle −0,1.', 'Industrial pollution −30%, industrial demand −0.1.'],
  'ord.tourism': ['Promotion touristique', 'Tourism board'],
  'ord.tourism.desc': ['Demande commerciale +0,15.', 'Commercial demand +0.15.'],
  'ord.energy': ['Économies d\'énergie', 'Energy saving'],
  'ord.energy.desc': ['Consommation électrique −15 %.', 'Power use −15%.'],
  'ord.parking': ['Stationnement payant', 'Parking fees'],
  'ord.parking.desc': ['Recette de 0,02 $ par habitant, trafic −10 %, demande résidentielle −0,05.', 'Earns $0.02 per resident, traffic −10%, residential demand −0.05.'],
  'diff.facile': ['Facile', 'Easy'],
  'diff.moyen': ['Moyen', 'Medium'],
  'diff.difficile': ['Difficile', 'Hard'],
  'months': ['Jan,Fév,Mar,Avr,Mai,Juin,Juil,Août,Sep,Oct,Nov,Déc', 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'],

  // ---- structures
  'struct.wind': ['Éolienne', 'Wind turbine'],
  'struct.wind.desc': ['8 MW, propre, prend de la place.', '8 MW, clean, takes room.'],
  'struct.coal': ['Centrale à charbon', 'Coal plant'],
  'struct.coal.desc': ['400 MW, bon marché, très polluante.', '400 MW, cheap, very dirty.'],
  'struct.gas': ['Centrale à gaz', 'Gas plant'],
  'struct.gas.desc': ['300 MW, pollution modérée.', '300 MW, moderate pollution.'],
  'struct.nuclear': ['Centrale nucléaire', 'Nuclear plant'],
  'struct.nuclear.desc': ['1 500 MW, aucune pollution.', '1,500 MW, no pollution.'],
  'struct.pump': ['Pompe à eau', 'Water pump'],
  'struct.pump.desc': ['Au bord de l\'eau. Alimente à 10 cases.', 'On the shore. Serves 10 tiles around.'],
  'struct.tower': ['Château d\'eau', 'Water tower'],
  'struct.tower.desc': ['N\'importe où. Alimente à 7 cases.', 'Anywhere. Serves 7 tiles around.'],
  'struct.police': ['Commissariat', 'Police station'],
  'struct.police.desc': ['Réduit la criminalité à 10 cases.', 'Cuts crime within 10 tiles.'],
  'struct.fire': ['Caserne de pompiers', 'Fire station'],
  'struct.fire.desc': ['Protège des incendies à 10 cases.', 'Fights fires within 10 tiles.'],
  'struct.school': ['École', 'School'],
  'struct.school.desc': ['Valeur foncière et attractivité.', 'Land value and appeal.'],
  'struct.hospital': ['Hôpital', 'Hospital'],
  'struct.hospital.desc': ['Valeur foncière et attractivité.', 'Land value and appeal.'],
  'struct.park': ['Petit parc', 'Small park'],
  'struct.park.desc': ['Petit bonus de valeur foncière.', 'Small land value bonus.'],
  'struct.bigpark': ['Grand parc', 'Large park'],
  'struct.bigpark.desc': ['Bon bonus de valeur foncière.', 'Good land value bonus.'],
  'struct.station': ['Gare', 'Rail station'],
  'struct.station.desc': ['À poser contre une voie ferrée et une route : les trajets passent par le rail.', 'Place against a railway and a road: commuters switch to the train.'],
  'struct.bus': ['Dépôt de bus', 'Bus depot'],
  'struct.bus.desc': ['Réduit de 40 % le trafic des habitants à 12 cases.', 'Cuts residents\' traffic by 40% within 12 tiles.'],
  'struct.port': ['Port', 'Seaport'],
  'struct.port.desc': ['Au bord de l\'eau. Dope la demande industrielle.', 'On the shore. Boosts industrial demand.'],
  'struct.airport': ['Aéroport', 'Airport'],
  'struct.airport.desc': ['Dope la demande commerciale. Bruyant.', 'Boosts commercial demand. Noisy.'],
  'struct.cityhall': ['Hôtel de ville', 'City hall'],
  'struct.cityhall.desc': ['Offert à 2 000 habitants. Valorise le quartier.', 'Granted at 2,000 residents. Raises nearby land value.'],
  'struct.statue': ['Statue du maire', 'Mayor\'s statue'],
  'struct.statue.desc': ['Offerte à 5 000 habitants. Un peu de prestige.', 'Granted at 5,000 residents. A little prestige.'],
  'struct.mansion': ['Résidence du maire', 'Mayor\'s mansion'],
  'struct.mansion.desc': ['Offerte à 10 000 habitants. Valorise le quartier.', 'Granted at 10,000 residents. Raises nearby land value.'],
  'struct.arcology': ['Arcologie', 'Arcology'],
  'struct.arcology.desc': ['Dès 25 000 habitants. Une ville dans une tour : 15 000 habitants, 5 000 emplois.', 'From 25,000 residents. A city in a tower: 15,000 residents, 5,000 jobs.'],
  'struct.meta': ['{size}×{size} · {cost} · {upkeep}/mois', '{size}×{size} · {cost} · {upkeep}/month'],

  // ---- tools & toolbar
  'tool.res': ['Résidentiel', 'Residential'],
  'tool.com': ['Commercial', 'Commercial'],
  'tool.ind': ['Industriel', 'Industrial'],
  'tool.road': ['Route', 'Road'],
  'tool.wire': ['Ligne HT', 'Power line'],
  'tool.wire.desc': ['Glisser pour tracer. Relie centrales et quartiers, passe au-dessus des routes et de l\'eau.', 'Drag to lay. Links plants and districts, runs over roads and water.'],
  'tool.bulldoze': ['Bulldozer', 'Bulldoze'],
  'tool.road.desc': ['Glisser pour tracer, en L. Sur l\'eau, devient un pont.', 'Drag to lay, L-shaped. Over water it becomes a bridge.'],
  'tool.bulldoze.desc': ['Glisser pour raser bâtiments, routes, lignes et rails.', 'Drag to clear buildings, roads, lines and tracks.'],
  'tool.query': ['Infos', 'Query'],
  'tool.rail': ['Voie ferrée', 'Railway'],
  'tool.rail.meta': ['25 $ / case · 75 $ sur l\'eau', '$25 / tile · $75 over water'],
  'tool.rail.desc': ['Glisser pour tracer. Traverse les routes. Sert avec des gares.', 'Drag to lay track. Crosses roads. Needs stations.'],
  'tool.highway': ['Autoroute', 'Highway'],
  'tool.highway.meta': ['50 $ / case · 250 $ sur l\'eau', '$50 / tile · $250 over water'],
  'tool.highway.desc': ['Capacité ×4, rapide. Les zones ne s\'y raccordent pas directement.', 'Capacity ×4, fast. Zones do not connect to it directly.'],
  'tool.raise': ['Élever', 'Raise'],
  'tool.raise.desc': ['Monte la case d\'un niveau, les voisines suivent en pente douce.', 'Lifts the tile one level; neighbours follow as gentle slopes.'],
  'tool.lower': ['Abaisser', 'Lower'],
  'tool.lower.desc': ['Descend la case d\'un niveau, jamais sous le niveau de la mer.', 'Drops the tile one level, never below sea level.'],
  'tool.level': ['Niveler (N)', 'Level (N)'],
  'tool.level.desc': ['Glisser un rectangle : tout est ramené à l\'altitude de la première case.', 'Drag a rectangle: everything is brought to the first tile\'s height.'],
  'tool.terra.meta': ['5 $ par coin déplacé', '$5 per corner moved'],
  'perTile': ['{n} $ / case', '${n} / tile'],
  'group.transport': ['Transport', 'Transport'],
  'group.energy': ['Énergie', 'Power'],
  'group.water': ['Eau', 'Water'],
  'group.services': ['Services', 'Services'],
  'group.parks': ['Parcs', 'Parks'],
  'flyout.choose': ['choisir…', 'choose…'],
  'help': ['Glisser pour tracer. Clic droit, espace ou flèches : déplacer. Molette : zoom. P : pause.', 'Drag to build. Right click, space or arrows: pan. Wheel: zoom. P: pause.'],
  'locked': ['Verrouillé : {pop} habitants requis', 'Locked: {pop} residents needed'],
  'touch.confirm': ['Touchez à nouveau la même case pour construire.', 'Tap the same tile again to build.'],
  'help.touch': ['Un doigt : déplacer la vue. Appui long : poser un bâtiment (il suit le doigt jusqu\'au relâchement) ou tracer avec l\'outil choisi. Un appui bref : info, ou aperçu puis second appui pour confirmer. Deux doigts : zoomer.', 'One finger: pan. Press and hold: place a building (it follows the finger until released) or draw with the selected tool. A short tap: info, or a preview then a second tap to confirm. Two fingers: zoom.'],
  'touch.tool.drag': ['{name} · appui long pour tracer', '{name} · press and hold to draw'],
  'touch.tool.tap': ['{name} · appui long pour poser', '{name} · press and hold to place'],
  'touch.release': ['Relâchez pour poser', 'Release to place'],
  'minimap.title': ['Carte', 'Map'],
  'minimap': ['Carte : appuyez pour vous y rendre', 'Map: tap to go there'],

  // ---- top bar & menus
  'top.funds': ['Fonds', 'Funds'],
  'top.date': ['Date', 'Date'],
  'top.pop': ['Population', 'Population'],
  'top.demand': ['Demande', 'Demand'],
  'top.demand.title': ['Demande : résidentiel / commercial / industriel', 'Demand: residential / commercial / industrial'],
  'top.power': ['Électricité', 'Power'],
  'top.power.title': ['Consommation / capacité', 'Use / capacity'],
  'top.water': ['Eau', 'Water'],
  'top.water.title': ['Part des bâtiments alimentés en eau', 'Share of buildings with water'],
  'top.perMonth': ['/ mois', '/ month'],
  'btn.budget': ['Budget', 'Budget'],
  'btn.maps': ['Cartes', 'Maps'],
  'btn.journal': ['Journal', 'Journal'],
  'btn.disasters': ['Catastrophes', 'Disasters'],
  'btn.cities': ['Villes', 'Cities'],
  'speed.pause': ['Pause (P)', 'Pause (P)'],
  'speed.1': ['Vitesse 1 (1)', 'Speed 1 (1)'],
  'speed.2': ['Vitesse 2 (2)', 'Speed 2 (2)'],
  'speed.3': ['Vitesse 3 (3)', 'Speed 3 (3)'],
  'menu.randomDisasters': ['Catastrophes aléatoires', 'Random disasters'],
  'legend': ['Carte : {name}', 'Map: {name}'],

  // ---- budget
  'budget.title': ['Budget mensuel', 'Monthly budget'],
  'budget.income': ['Recettes', 'Income'],
  'budget.taxRate': ['Taux d\'imposition', 'Tax rate'],
  'budget.totalIncome': ['Total recettes', 'Total income'],
  'budget.expenses': ['Dépenses', 'Expenses'],
  'budget.roads': ['Voirie, rails et lignes', 'Roads, rail and lines'],
  'budget.plants': ['Centrales', 'Power plants'],
  'budget.water': ['Eau', 'Water'],
  'budget.parks': ['Parcs', 'Parks'],
  'budget.transport': ['Gares, bus, port, aéroport', 'Stations, buses, port, airport'],
  'budget.ordinances': ['Arrêtés municipaux', 'Ordinances'],
  'budget.interest': ['Intérêts des emprunts', 'Bond interest'],
  'budget.totalExpenses': ['Total dépenses', 'Total expenses'],
  'budget.balance': ['Solde', 'Balance'],
  'budget.net': ['Solde mensuel', 'Monthly balance'],
  'budget.funds': ['Fonds disponibles', 'Available funds'],
  'budget.bonds': ['Emprunts', 'Bonds'],
  'budget.bondsInfo': ['{n} emprunt(s) en cours (6 %/an)', '{n} bond(s) outstanding (6%/yr)'],
  'budget.issue': ['Emprunter {amt}', 'Borrow {amt}'],
  'budget.repay': ['Rembourser {amt}', 'Repay {amt}'],
  'budget.ordTitle': ['Arrêtés municipaux', 'City ordinances'],
  'budget.indicators': ['Indicateurs', 'Indicators'],
  'budget.lv': ['Valeur foncière moyenne', 'Average land value'],
  'budget.crime': ['Criminalité moyenne', 'Average crime'],
  'budget.cov.police': ['Couverture police', 'Police coverage'],
  'budget.cov.fire': ['Couverture pompiers', 'Fire coverage'],
  'budget.cov.education': ['Couverture scolaire', 'School coverage'],
  'budget.cov.health': ['Couverture hospitalière', 'Hospital coverage'],
  'budget.cov.water': ['Habitations avec eau', 'Homes with water'],
  'perMonthSign': ['{sign}{amt}/mois', '{sign}{amt}/month'],

  // ---- journal
  'journal.title': ['Journal de la ville', 'City journal'],
  'journal.pop': ['Population, 10 dernières années', 'Population, last 10 years'],
  'journal.money': ['Fonds, 10 dernières années', 'Funds, last 10 years'],
  'journal.advice': ['Conseils', 'Advice'],
  'journal.events': ['Événements', 'Events'],
  'journal.noData': ['Pas encore assez de mois.', 'Not enough months yet.'],
  'journal.fine': ['Rien à signaler, la ville se porte bien.', 'Nothing to report, the city is doing fine.'],

  // ---- cities & welcome
  'cities.title': ['Villes', 'Cities'],
  'cities.load': ['Charger', 'Load'],
  'cities.current': ['En cours', 'Current'],
  'cities.delete': ['Supprimer', 'Delete'],
  'cities.none': ['Aucune ville sauvegardée.', 'No saved city.'],
  'cities.new': ['Nouvelle ville', 'New city'],
  'cities.info': ['{pop} hab. · {date}', '{pop} pop. · {date}'],
  'welcome.tagline': ['Fondez une ville, faites-la grandir.', 'Found a city, make it grow.'],
  'welcome.name': ['Nom de la ville', 'City name'],
  'welcome.namePh': ['Nouvelle ville', 'New city'],
  'welcome.difficulty': ['Difficulté', 'Difficulty'],
  'welcome.map': ['Carte', 'Map'],
  'welcome.random': ['Au hasard', 'Random'],
  'welcome.more': ['Autres cartes', 'More maps'],
  'welcome.found': ['Fonder la ville', 'Found the city'],
  'welcome.cancel': ['Annuler', 'Cancel'],
  'welcome.lang': ['Langue', 'Language'],
  'diff.facile.desc': ['Demande soutenue, entretien −15 %, catastrophes rares, emprunts à 5 %.', 'Strong demand, upkeep −15%, rare disasters, 5% bonds.'],
  'diff.moyen.desc': ['Équilibré : demande, coûts et risques normaux, emprunts à 6 %.', 'Balanced: normal demand, costs and risks, 6% bonds.'],
  'diff.difficile.desc': ['Demande timide, entretien +25 %, catastrophes fréquentes, emprunts à 8 %.', 'Timid demand, upkeep +25%, frequent disasters, 8% bonds.'],
  'credits': ['Réalisé par Erwann avec Claude Fable 5.1', 'Made by Erwann with Claude Fable 5.1'],
  'unnamed': ['Sans nom', 'Unnamed'],

  // ---- status & messages
  'status.demo': ['Ville de démonstration : rien ne sera sauvegardé.', 'Demo city: nothing will be saved.'],
  'status.restored': ['{name} restaurée.', '{name} restored.'],
  'status.founded': ['{name} est fondée. Une centrale, des routes, puis des zones : R, C, I. Routes {road} $, zones {zone} $ la case.', '{name} is founded. A power plant, roads, then zones: R, C, I. Roads ${road}, zones ${zone} per tile.'],
  'status.loaded': ['{name} chargée.', '{name} loaded.'],
  'status.unreadable': ['Sauvegarde illisible.', 'Save file unreadable.'],
  'status.bondMax': ['Plafond d\'emprunt atteint.', 'Borrowing limit reached.'],
  'status.repayFail': ['Remboursement impossible.', 'Cannot repay now.'],
  'status.deleteConfirm': ['Supprimer définitivement « {name} » ?', 'Permanently delete "{name}"?'],
  'preview.tiles': ['{n} case(s) · {cost} $', '{n} tile(s) · ${cost}'],
  'preview.item': ['{name} · {cost}', '{name} · {cost}'],
  'disaster.go': ['{name} !', '{name}!'],
  'disaster.nothing': ['Rien à brûler.', 'Nothing to burn.'],

  // ---- tool reasons
  'reason.flat': ['Terrain en pente : nivelez d\'abord.', 'Sloped ground: level it first.'],
  'reason.offmap': ['Hors de la carte.', 'Off the map.'],
  'reason.occupied': ['Terrain occupé : passez d\'abord le bulldozer.', 'Occupied: bulldoze first.'],
  'reason.shore': ['{name} doit toucher l\'eau.', '{name} must touch water.'],
  'reason.station': ['Une gare doit toucher une voie ferrée et une route.', 'A station must touch a railway and a road.'],
  'reason.locked': ['Disponible à partir de {pop} habitants.', 'Available from {pop} residents.'],
  'reason.nothing': ['Rien à construire ici.', 'Nothing to build here.'],
  'reason.funds': ['Fonds insuffisants.', 'Not enough funds.'],
  'reason.terraMax': ['Altitude maximale atteinte.', 'Maximum height reached.'],
  'reason.terraMin': ['Impossible de creuser sous le niveau de la mer.', 'Cannot dig below sea level.'],
  'reason.terraNone': ['Rien à modifier.', 'Nothing to change.'],
  'reason.terraShore': ['Impossible de modifier le rivage.', 'The shoreline cannot be changed.'],
  'reason.terraTooBig': ['Modification trop étendue.', 'Change too large.'],

  // ---- advice
  'advice.fire': ['{n} case(s) en feu : les casernes proches limitent les dégâts.', '{n} tile(s) on fire: nearby fire stations limit the damage.'],
  'advice.broke': ['Les caisses sont vides : plus de construction possible tant que la ville est à découvert.', 'The coffers are empty: no building until the city is out of the red.'],
  'advice.noPlant': ['Aucune centrale électrique : rien ne se construira sans courant.', 'No power plant: nothing gets built without power.'],
  'advice.powerShort': ['Capacité électrique insuffisante : des quartiers sont privés de courant.', 'Not enough power capacity: some districts are dark.'],
  'advice.unconnected': ['Des zones ne sont pas raccordées au réseau électrique (lignes ou zones adjacentes).', 'Some zones are not connected to the grid (power lines or adjacent zones).'],
  'advice.noJobsZones': ['Les habitants n\'ont aucun emploi à rejoindre : zonez du commercial ou de l\'industriel près des routes.', 'Residents have no jobs to go to: zone commercial or industrial land near roads.'],
  'advice.tripsFail': ['Des quartiers sont trop loin des emplois ou coincés dans les bouchons : reliez-les mieux.', 'Some districts are too far from jobs or stuck in traffic: connect them better.'],
  'advice.jams': ['Embouteillages : doublez les axes, tracez une autoroute ou installez bus et gares.', 'Traffic jams: double the arteries, build a highway or add buses and stations.'],
  'advice.water': ['Sans eau courante, les quartiers restent en faible densité.', 'Without running water, districts stay low density.'],
  'advice.crime': ['La criminalité inquiète : construisez des commissariats.', 'Crime is worrying: build police stations.'],
  'advice.fewFire': ['Peu de casernes : un incendie ferait de gros dégâts.', 'Few fire stations: a fire would do serious damage.'],
  'advice.lowLV': ['Valeur foncière faible : parcs, écoles et distance aux usines feront monter la densité.', 'Low land value: parks, schools and distance from factories will raise density.'],
  'advice.needR': ['Les habitants réclament davantage de zones résidentielles.', 'People are asking for more residential zones.'],
  'advice.needC': ['Les commerçants cherchent des terrains : zonez du commercial.', 'Shopkeepers want land: zone commercial.'],
  'advice.needI': ['Les industriels veulent s\'implanter : zonez de l\'industriel.', 'Industry wants to move in: zone industrial.'],
  'advice.noJobs': ['Pas assez d\'emplois : les habitants quittent la ville.', 'Not enough jobs: people are leaving town.'],

  // ---- log
  'log.milestone': ['La ville dépasse {n} habitants.', 'The city passes {n} residents.'],
  'log.reward': ['Récompense débloquée : {name} (menu Récompenses).', 'Reward unlocked: {name} (Rewards menu).'],
  'log.founded': ['{name} est fondée.', '{name} is founded.'],
  'log.fire': ['Un incendie s\'est déclaré en ({x}, {y}).', 'A fire broke out at ({x}, {y}).'],
  'log.flood': ['Inondation : la mer envahit les rives, {n} constructions détruites.', 'Flood: the sea swamps the shores, {n} buildings destroyed.'],
  'log.tornado': ['Une tornade touche terre en ({x}, {y}).', 'A tornado touches down at ({x}, {y}).'],
  'log.quake': ['Séisme centré en ({x}, {y}) : {n} constructions détruites.', 'Earthquake centred at ({x}, {y}): {n} buildings destroyed.'],

  // ---- query panel
  'query.tile': ['Case {x}, {y}', 'Tile {x}, {y}'],
  'query.water': ['Eau', 'Water'],
  'query.bare': ['Terrain nu', 'Bare land'],
  'query.forest': ['Forêt', 'Forest'],
  'query.road': ['Route', 'Road'],
  'query.bridge': ['Pont', 'Bridge'],
  'query.rail': ['Voie ferrée', 'Railway'],
  'query.railBridge': ['Pont ferroviaire', 'Rail bridge'],
  'query.crossing': ['Passage à niveau', 'Level crossing'],
  'query.roadWire': ['Route et ligne électrique', 'Road and power line'],
  'query.highway': ['Autoroute', 'Highway'],
  'query.hwyBridge': ['Pont autoroutier', 'Highway bridge'],
  'query.rubble': ['Décombres', 'Rubble'],
  'query.rubbleHint': ['À déblayer au bulldozer avant de reconstruire.', 'Bulldoze before rebuilding.'],
  'query.traffic': ['Trafic : {n} navetteurs / mois ({state})', 'Traffic: {n} commuters / month ({state})'],
  'state.free': ['fluide', 'flowing'],
  'state.dense': ['dense', 'heavy'],
  'state.jammed': ['saturé', 'jammed'],
  'query.zone': ['{label} · densité {lvl}/5', '{label} · density {lvl}/5'],
  'query.empty': ['Zone non construite', 'Undeveloped zone'],
  'query.pop': ['{n} habitants', '{n} residents'],
  'query.jobs': ['{n} emplois', '{n} jobs'],
  'query.noRoad': ['Aucune route à moins de 3 cases', 'No road within 3 tiles'],
  'query.onRoad': ['Sur la route', 'On the road'],
  'query.roadAt': ['Route à {n} case(s)', 'Road {n} tile(s) away'],
  'query.jobsOk': ['Emplois accessibles', 'Jobs within reach'],
  'query.jobsNo': ['Aucun emploi à portée de trajet : ne se développera pas', 'No jobs within commuting range: will not develop'],
  'query.workersOk': ['Main-d\'œuvre accessible', 'Workers within reach'],
  'query.workersNo': ['Aucun habitant à portée de trajet : ne se développera pas', 'No residents within commuting range: will not develop'],
  'query.powerYes': ['Électricité : oui', 'Power: yes'],
  'query.powerNo': ['Électricité : non, ne se développera pas', 'Power: no, will not develop'],
  'query.waterYes': ['Eau : oui', 'Water: yes'],
  'query.waterNo': ['Eau : non, plafonné en faible densité', 'Water: no, capped at low density'],
  'query.upkeep': ['Entretien : {amt} / mois', 'Upkeep: {amt} / month'],
  'query.produces': ['Produit {mw} MW', 'Produces {mw} MW'],
  'query.powered': ['Alimenté en électricité', 'Powered'],
  'query.unpowered': ['Pas d\'électricité : hors service', 'No power: out of service'],
  'query.funding': ['Financement : {pct} %', 'Funding: {pct}%'],
  'query.onFire': ['EN FEU', 'ON FIRE'],
  'query.flooded': ['Inondé, l\'eau se retire dans {n} mois', 'Flooded, water recedes in {n} months'],
  'query.altitude': ['Altitude : {h}', 'Altitude: {h}'],
  'query.slope': [' (en pente)', ' (sloped)'],
  'query.wire': ['Ligne électrique', 'Power line'],
  'query.lv': ['Valeur foncière : {label} ({v})', 'Land value: {label} ({v})'],
  'lv.low': ['faible', 'low'],
  'lv.mid': ['moyenne', 'average'],
  'lv.good': ['bonne', 'good'],
  'lv.great': ['excellente', 'excellent'],
  'query.pollution': ['Pollution : {label}', 'Pollution: {label}'],
  'level.none': ['nulle', 'none'],
  'level.low': ['faible', 'low'],
  'level.mid': ['moyenne', 'moderate'],
  'level.high': ['forte', 'high'],
  'query.crime': ['Criminalité : {label}', 'Crime: {label}'],
  'query.services': ['Services : {list}', 'Services: {list}'],
  'query.noServices': ['Aucun service à portée', 'No service in range'],
};

export function t(key: string, params?: Record<string, string | number>): string {
  const entry = D[key];
  let s = entry ? entry[lang === 'fr' ? 0 : 1] : key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function months(): string[] {
  return t('months').split(',');
}

export function fmtMoney(n: number): string {
  const v = Math.round(n).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
  return lang === 'fr' ? `${v} $` : `$${v}`;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
}

/** All dictionary keys, for the coverage check script. */
export const DICT_KEYS = Object.keys(D);
