# Notes de version

Format : une section par version, la plus récente en premier. Les entrées sont
rédigées pour les joueurs, pas pour les développeurs.

## 0.7.0 — 2026-09-06

Des cartes plus belles et plus variées.

- Cinq familles de cartes au choix à l'accueil : côte, rivière, lacs,
  archipel, montagne. La rivière serpente d'un bord à l'autre avec un affluent ; il
  faudra des ponts. L'archipel laisse moins de la moitié de la carte en
  terre ferme.
- Les rives sont adoucies : bande de sable et eau claire le long des berges,
  angles arrondis dans les anses, caps adoucis. Tout se passe dans les cases
  d'eau, une case de terre reste un losange entier : on voit où l'on peut
  bâtir.
- L'eau fonce en s'éloignant du rivage.
- Le relief se lit : l'herbe passe du vert tendre en plaine au sol sec et
  rocailleux sur les hauteurs.
- Les forêts poussent en bosquets, plus denses près de l'eau, avec des
  essences par massif : feuillus sombres, bois clairs mêlés de roux,
  conifères qui prennent le dessus en altitude.
- Une centrale de plus : la fusion, 6 000 MW propres à 100 000 habitants,
  qui remplace quatre nucléaires. La centrale nucléaire est redessinée :
  dôme de confinement, tour de refroidissement qui fume, salle des machines.
- Les éoliennes se posent aussi en mer, où elles donnent 12 MW au lieu de 8.
- Une centrale nucléaire proche de l'épicentre d'un séisme peut céder :
  le bloc et ses abords sont dévastés et prennent feu. La fusion, elle, ne
  craint rien.
- Le palier de 20 000 habitants annonce enfin ses déblocages (aéroport,
  nucléaire) dans le journal.
- Vue à plat, touche V ou bouton de la mini-carte : immeubles et équipements
  deviennent de simples emprises colorées au sol, plus foncées avec la
  densité. Pratique pour passer le bulldozer sur des décombres coincés
  derrière des tours.

## 0.6.5 — 2026-09-06

- Plus d'embranchement ni de carrefour sur un pont, routier comme
  ferroviaire : deux ponts qui se touchaient formaient un carrefour sur
  l'eau. Les ponts en courbe restent possibles.

## 0.6.4 — 2026-09-06

Des ponts pour les trains.

- Sur l'eau, la voie ferrée repose désormais sur un pont à chevalets, avec
  ses rampes aux rives et ses piles, virages et embranchements compris ; elle
  était posée à même l'eau. Quand elle croise un pont routier, elle passe sur
  son tablier.
- Rail et route ne se croisent plus sur un pont : ça n'existe pas, et il
  faudra choisir où franchir l'eau. Le message de refus le dit.
- Les feux et lampes des panneaux suivent le relief au lieu de flotter sur
  les cases en pente.

## 0.6.3 — 2026-09-06

Ponts ferroviaires, passages à niveau et signalisation.

- La voie ferrée franchit les autoroutes sur un pont : rampes sur remblai de
  part et d'autre, tablier sur piles, les trains passent au-dessus des
  voitures. Une autoroute peut aussi être tracée sous une voie existante.
- Les passages à niveau ont leurs croix de Saint-André et leurs barrières,
  avec des feux qui clignotent à l'approche d'un train.
- Feux tricolores à chaque entrée de carrefour, panneaux stop et lignes
  d'arrêt au sol là où l'on cède le passage : route qui débouche sur une
  autoroute, autoroute qui se termine sur une route traversante. Panneaux et
  feux sont placés à droite de la voie qui arrive et tournés vers elle.
- Les voitures roulent à droite sur tous les axes ; elles roulaient à gauche
  sur les routes d'un des deux axes.
- L'autoroute se rétrécit progressivement là où elle continue en route, et
  les routes qui y débouchent s'évasent au carrefour, au lieu d'un décroché
  brutal.
- Quand un tracé en L bute sur un croisement interdit, l'autre L est essayé ;
  si une case reste exclue, un message l'explique.

## 0.6.2 — 2026-09-06

Des messages qui se voient.

- Les événements marquants s'affichent en surimpression sur la carte, comme
  les refus de construction : catastrophes (un clic sur le message centre la
  vue dessus), paliers de population avec les équipements débloqués, compte à
  rebours avant la faillite.

## 0.6.1 — 2026-09-06

Correctif.

- Choisir un outil dans un sous-menu (Route dans Transport, par exemple) juste
  après avoir ouvert le groupe ramenait à la loupe au lieu de le sélectionner.

## 0.6.0 — 2026-09-06

Une progression, des bâtiments plus soignés et des retours de la version mobile.

- Les équipements lourds se débloquent avec la population : dépôt de bus et
  grand parc à 1 000 habitants, hôpital et centrale à gaz à 2 500, rail et
  gare à 5 000, autoroute et port à 10 000, aéroport et nucléaire à 20 000.
- La reprise après faillite ramène à une photo prise tous les six mois tant
  que les comptes sont sains, annoncée clairement ; une ville en faillite ne
  tourne plus tant qu'on n'a pas choisi.
- Commissariat, caserne et grand parc passent en 2×2. Le grand parc a quatre
  aménagements et se relie à ses voisins derrière une seule grille. École,
  gare et dépôt de bus redessinés, avec voiture de patrouille, camion, bus.
- Le tableau de bord montre aussi l'électricité et l'eau ; il s'ouvre depuis
  les barres de demande, la consommation ou l'eau du bandeau.
- Sur téléphone : chiffres abrégés dans le bandeau, Mes villes centré, plus de
  symbole à côté de la date, texte d'aide de l'accueil retiré.

## 0.5.0 — 2026-09-06

On peut désormais perdre, et la barre d'outils va plus vite.

- Faillite : six mois d'affilée sous le plancher de la difficulté (−10 000 $
  en facile, −5 000 $ en moyen, 0 $ en difficile) et le conseil vous démet.
  Le journal compte les mois restants. L'écran de faillite permet de reprendre
  la partie juste avant la crise, d'ouvrir Mes villes ou de fonder une autre
  ville.
- Les emprunts sont plafonnés : cinq en facile, trois en moyen, deux en
  difficile, au taux de la difficulté.
- Un groupe d'outils sélectionne d'emblée son premier outil, route, ligne
  haute tension, pompe, commissariat, parc ou bulldozer : on peut tracer tout
  de suite.
- Les refus de construction, fonds insuffisants ou terrain impossible,
  s'affichent en bandeau rouge bien visible.
- Les ponts ont des rampes aux extrémités et les voitures roulent sur le
  tablier.

## 0.4.4 — 2026-09-05

- Sur téléphone, les barres de demande R, C, I sont aussi dans le bandeau du
  haut, en version compacte ; un appui dessus ouvre le détail.

## 0.4.3 — 2026-09-05

- Le volet Demande a une croix pour se fermer.
- Un appui sur la carte referme les menus ouverts ; sur téléphone, aussi les
  volets qui couvrent le jeu.

## 0.4.2 — 2026-09-05

- Les barres de demande R, C, I sont dans l'en-tête de la mini-carte, donc
  visibles aussi sur téléphone.
- Un appui sur ces barres, ou sur celles du bandeau, ouvre le détail de la
  demande avec les pourcentages et un conseil.

## 0.4.1 — 2026-09-05

- Caserne redessinée : bâtiment en brique, aile à trois garages dont un ouvert
  d'où sort le camion, tour de séchage, drapeau.
- Port redessiné et tourné vers l'eau : quai, entrepôt, conteneurs, portique.
- Portes et fenêtres des maisons dessinées dans le plan des façades.
- Boutons de vitesse de même taille sur tous les écrans.

## 0.4.0 — 2026-09-05

La ville s'anime.

- Fumée au-dessus des usines et des centrales, tant qu'elles ont du courant.
- Trains sur le réseau ferré (locomotive, voiture voyageurs, wagon plat), cargo
  près du port, voiliers sur les grandes étendues d'eau.
- Un avion décolle de l'aéroport, survole la ville et se pose.
- Feux clignotants au sommet des tours et des antennes, gyrophares sur la
  caserne et le commissariat.
- Fontaine du grand parc et balançoire de l'aire de jeux animées.
- Une grue de chantier travaille quelques mois sur chaque bâtiment qui monte de
  niveau.
- Nouveau logo : le o de Town est un casque de chantier ; nouveau favicon.
- Le bouton de langue montre la langue en cours.

## 0.3.5 — 2026-09-05

- Le bouton des sauvegardes affiche le nom de la ville en cours.

## 0.3.4 — 2026-09-05

- Les petits parcs voisins forment un seul jardin : chemins qui se rejoignent,
  haie sur le pourtour, étang, aire de jeux, bancs et parterres.
- Mini-tutoriel en six écrans derrière le bouton « ? » en haut à droite ; il
  s'ouvre de lui-même après la première ville créée.
- Le menu Catastrophes et le bouton d'aide de la barre d'outils disparaissent.
  Les catastrophes surviennent selon la difficulté, sans réglage.
- Le bouton des sauvegardes s'appelle « Mes villes ».
- Boutons de vitesse de même taille.

## 0.3.3 — 2026-09-05

- Les chiffres du bandeau ouvrent ce qui les explique : les fonds le budget,
  la population le journal, la date les commandes de vitesse.
- Sur mobile, les boutons de vitesse ne s'affichent qu'en appuyant sur la
  date ; en pause, un symbole l'indique à côté de la date.
- La mini-carte a un bouton qui ouvre les cartes de données et affiche le nom
  de la carte active.
- Sur mobile, les volets passent devant la mini-carte : le menu Villes n'est
  plus caché.

## 0.3.2 — 2026-09-05

- Les zones encore vides se voient enfin : hachures, contour marqué et lettre
  R, C ou I. L'aperçu pendant le tracé est cerclé de blanc.
- La pastille « pas de route » montre un tronçon de route barré au lieu d'un
  point rouge.
- Routes, autoroutes et rails prennent leurs virages en courbe.
- La gare se tourne pour longer sa voie.
- Le port et la pompe exigent de l'eau bord à bord, plus seulement un coin.

## 0.3.1 — 2026-09-05

- Sur téléphone, un appui long pose directement un bâtiment : l'emprise suit
  le doigt et se pose au relâchement. Le double appui reste possible.
- Les rotors des éoliennes tournent.

## 0.3.0 — 2026-09-05

Le tactile revu de fond en comble, une mini-carte et une barre d'outils plus
claire.

- Sur téléphone, un doigt déplace toujours la vue, sans à-coups. Un appui bref
  utilise l'outil sur une case, un appui long puis un glissement trace routes,
  zones et lignes. Le pincement zoome sans plus faire sauter la vue.
- La loupe devient le mode par défaut : un appui ou un clic renseigne sur une
  case. Réappuyer sur l'outil actif y ramène, comme Échap. Sur mobile, une
  pastille rappelle l'outil de construction en cours avec une croix pour en
  sortir.
- Mini-carte en bas à droite avec le cadre de la zone visible ; appuyer dessus
  déplace la vue.
- Barre d'outils réorganisée en dix boutons : la route ouvre tout le groupe
  Transport, les monuments rejoignent les Parcs, le relief rejoint le
  Bulldozer. Vignettes plus grandes et plus lisibles, éolienne et statue
  redessinées, maisons aux couleurs plus gaies.
- Les lignes haute tension traversent l'eau sur des pylônes, au lieu de
  laisser un trou.

## 0.2.0 — 2026-09-05

Le jeu se joue sur téléphone et tablette, et les rues prennent vie.

- Jouable au tactile : un doigt déplace la vue ou trace avec l'outil choisi,
  deux doigts déplacent et zooment. Pour poser un bâtiment, un premier appui
  montre l'emplacement, un second au même endroit confirme.
- Mise en page adaptée aux petits écrans : barre d'outils en bas, panneaux en
  volets, bandeau réduit à l'essentiel.
- De vraies voitures sur les routes : berlines et fourgonnettes de toutes
  couleurs, avec phares et feux arrière, qui roulent sur leur voie.
- Une voie ferrée ne peut plus longer une rue : rail et route ne se croisent
  qu'en passage à niveau, tout droit.
- Écran d'accueil : la carte au hasard s'affiche avec un « ? », les aperçus de
  cartes occupent toute la largeur, la somme de départ n'est plus affichée.
- Le drapeau anglais s'affiche en entier.
- Les captures du site montrent toujours la version publiée.

## 0.1.1 — 2026-09-05

Réglages d'interface et de confort après la première mise en ligne.

- Écran d'accueil : la difficulté se choisit avec un curseur, les détails de
  chaque niveau apparaissent au survol.
- Barre d'outils en grandes icônes avec infobulle ; la ligne haute tension
  rejoint le groupe Énergie ; le bulldozer a son pictogramme ; le menu Villes
  reste en haut à droite avec les sauvegardes.
- Les pastilles « pas de route », « pas de courant » et « pas d'eau » sont
  nettement plus lisibles.
- Le château d'eau tient d'aplomb sur ses poteaux.
- Zoom intermédiaire entre 1 et 2.
- Le courant franchit désormais une voie ferrée ou une autoroute comme il
  franchit une route.
- Ville de démonstration au contour naturel, sans catastrophe aléatoire.

## 0.1.0 — 2026-09-05

Première version publique.

- Carte isométrique 128 × 128 avec eau, forêts et relief en terrasses, outils
  de terraformage.
- Zones résidentielles, commerciales et industrielles sur cinq niveaux, avec
  fusion en immeubles 2 × 2 et 3 × 3.
- Routes, ponts, lignes haute tension, voie ferrée et gares, autoroutes,
  dépôts de bus, port, aéroport.
- Énergie, eau, police, pompiers, écoles, hôpitaux, parcs, récompenses de
  maire et arcologie.
- Demande, valeur foncière, pollution, criminalité, trajets et trafic, budget
  détaillé, emprunts, arrêtés municipaux, trois difficultés.
- Incendies, inondations, tornades, séismes.
- Journal, cartes de données, sauvegardes multiples, français et anglais.
