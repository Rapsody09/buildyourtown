# BuildYourTown

Version 0.1.0 (la version vit dans `package.json`, s'affiche en bas du jeu et
est posée en label sur l'image Docker).

Un city-builder isométrique dans l'esprit des grands classiques du genre, en
TypeScript, rendu sur un canvas 2D, sans backend. Domaine : buildyourtown.com.
Tout l'outillage tourne dans Docker : rien n'est installé sur la machine hôte.

## Lancer

```sh
make image   # construit l'image de dev (à refaire quand package.json change)
make dev     # serveur Vite avec rechargement à chaud -> http://localhost:5173
```

`http://localhost:5173/?demo=10` ouvre une ville de démonstration déjà
construite et simulée sur 10 ans (jamais sauvegardée). Paramètres optionnels :
`&map=landValue` (carte de données au démarrage), `&zoom=1`, `&showcase`
(force quelques bâtiments 2×2 et 3×3), `&panel=budget` ou `&panel=journal`,
`&disaster=fire|flood|tornado|quake`, `&welcome` (écran d'accueil).
`?lang=fr` ou `?lang=en` force la langue et la mémorise.

Autres cibles : `make build` (typecheck + build de prod dans `dist/`),
`make typecheck`, `make simtest ARGS="30 12345 7 mixed"` (simulation headless
pour vérifier l'équilibrage : années, graine, taux d'impôt,
`mixed`/`res-only`/`bare`/`disasters`), `make lock` (régénère
`package-lock.json`), `make sh` (shell dans le conteneur).

## Langues et accueil

- Interface en **français** ou en **anglais** : détection du navigateur au
  premier lancement, bouton FR / EN dans le bandeau, choix sur l'écran
  d'accueil. Toutes les chaînes vivent dans `src/i18n.ts` (une clé, deux
  textes) ; les entrées du journal sont stockées sous forme de clé et
  traduites à l'affichage.
- **Écran d'accueil** au premier lancement, et via Villes → Nouvelle ville :
  nom, difficulté, carte au hasard ou choisie parmi cinq aperçus isométriques
  régénérables.

## Jouer

- Barre d'outils à gauche, en icônes : survoler pour voir le nom, le coût et
  la touche. **R / C / I** zones résidentielle / commerciale / industrielle,
  **T** route, **L** ligne haute tension, **N** niveler, **B** bulldozer, **Q**
  infos sur une case, **Échap** aucun outil. Les groupes Transport, Énergie,
  Eau, Services, Parcs, Terrain et Récompenses ouvrent la liste de leurs
  outils (clic pour poser, aperçu vert ou rouge). En bas de la barre : Budget,
  Cartes, Journal, Catastrophes, Villes et l'aide ; les panneaux s'ouvrent à
  côté.
- Glisser pour tracer : routes et lignes suivent un L, les zones un
  rectangle. Le coût s'affiche en bas à droite avant de lâcher.
- Clic droit, molette-clic, espace + glisser ou flèches : déplacer la vue.
  Molette : zoom (¼ à 2×). **P** pause, **1 / 2 / 3** vitesse.

### Ce qui fait vivre la ville

- **Relief** : le terrain est en terrasses, chaque changement d'altitude est
  une pente douce. On ne construit qu'à plat : Élever, Abaisser et Niveler
  (5 $ par coin déplacé) façonnent le terrain, les voisines suivent en pente.
  Les routes épousent les pentes. Une route tracée sur l'eau devient un pont
  (50 $ la case). Les hauteurs valorisent un peu le foncier.
- **Densité** : à partir du niveau 4, les zones voisines de même type
  fusionnent en bâtiments 2×2, puis 3×3 au niveau 5, si la valeur foncière et
  l'eau le permettent. Le bulldozer détruit tout le bâtiment, le zonage reste.
- **Routes et trajets** : une zone doit avoir une route à 3 cases ou moins
  (point rouge sinon). Chaque mois, les habitants rejoignent les emplois les
  plus proches par le réseau, et les commerces et usines doivent atteindre des
  habitants. Un trajet trop long (60 pas pondérés) coupe la zone. Les
  navetteurs se cumulent sur chaque case de route : au-delà de 1 200 par mois
  la case sature, coûte plus cher à traverser, pollue et fait baisser le
  foncier voisin. Carte « Trafic » pour voir tout ça.
- **Transports** : voie ferrée (25 $) avec gares, à poser contre le rail et
  une route, pour que les trajets passent par le train ; dépôt de bus qui
  retire 40 % des navetteurs à 12 cases ; autoroute (50 $) à capacité
  quadruple mais sans accès direct pour les zones ; port (au bord de l'eau)
  et aéroport qui dopent la demande industrielle et commerciale.
- **Électricité** : les zones ne se développent que sous tension (éclair
  jaune sinon). Le courant passe de proche en proche entre zones, bâtiments
  et lignes HT, et traverse une route d'une case de large. Centrales : éolienne,
  charbon, gaz, nucléaire. Si la consommation dépasse la capacité, les quartiers
  les plus éloignés des centrales sont coupés.
- **Eau** : pompes (au bord de l'eau) et châteaux d'eau alimentent un rayon
  autour d'eux. Sans eau, une zone plafonne en faible densité (goutte bleue).
- **Valeur foncière** : montée par l'eau, les forêts, les parcs et les
  services, plombée par la pollution et la criminalité. Elle plafonne la
  densité du résidentiel et du commercial et module les recettes fiscales.
- **Criminalité** : croît avec la densité et la faible valeur foncière, réduite
  par les commissariats. Pompiers, écoles et hôpitaux améliorent la valeur
  foncière et l'attractivité.
- **Demande R / C / I** : les habitants viennent s'il y a des emplois, les
  commerces suivent la population, l'industrie a un marché extérieur qui
  grandit avec les années. Les impôts (0 à 20 %) freinent ou dopent la demande.
- **Budget** (bouton Budget) : recettes par type de zone, dépenses par poste,
  financement de chaque service (sous-financer la police fait remonter le
  crime), emprunts de 10 000 $ à 6 %.
- **Cartes** : pollution, criminalité, valeur foncière, électricité, eau,
  couverture de chaque service.
- **Villes** : plusieurs sauvegardes dans le navigateur (localStorage), création
  d'une ville avec nom et difficulté. La difficulté fixe les fonds de départ
  (20 000 / 10 000 / 5 000 $), multiplie la demande (×1,15 / ×1 / ×0,85), les
  dépenses mensuelles (×0,85 / ×1 / ×1,25), la fréquence des catastrophes
  (×0,5 / ×1 / ×1,6) et le taux des emprunts (5 / 6 / 8 %).
- **Catastrophes** (menu dédié, ou aléatoires si la case est cochée) :
  incendies qui se propagent de proche en proche, ralentis et éteints par les
  casernes financées ; inondation des rives basses ; tornade qui se promène ;
  séisme qui secoue l'écran. Ce qui brûle ou s'écroule laisse
  des décombres à déblayer au bulldozer. Une zone privée de courant ou
  d'accès se vide lentement, le maire a quelques mois pour réparer.
- **Journal** : courbes de population et de fonds sur dix ans, tous les
  conseils du moment, historique des événements (catastrophes, paliers de
  population, récompenses).
- **Récompenses** : hôtel de ville à 2 000 habitants, statue à 5 000,
  résidence du maire à 10 000, arcologie à 25 000 (15 000 habitants et
  5 000 emplois dans une tour de 4×4, 30 000 $).
- **Arrêtés municipaux** (dans le budget) : voisins vigilants, contrôle des
  émissions, promotion touristique, économies d'énergie, stationnement payant.
  Chacun a un coût ou une recette par habitant.

## Apparence

- Bâtiments dessinés à la volée à partir de palettes gaies (huit teintes de
  maisons, crépis et briques claires pour les immeubles, verre bleu-vert pour
  les bureaux, bardages colorés pour l'industrie), quatre silhouettes
  différentes par niveau et par type, y compris pour les immeubles 2×2 et 3×3. Formes rondes pour les cuves, cheminées, châteaux d'eau, tours de
  refroidissement et dômes ; auvents rayés sur les commerces, lignes d'étage,
  machineries en toiture, cheminées sur les maisons.
- Interface façon jeu : police Baloo 2 / Nunito (Google Fonts, repli système),
  panneaux sombres arrondis, boutons en relief, vignettes isométriques des
  outils rendues depuis les sprites eux-mêmes. Bandeau du haut réduit aux
  chiffres (icône + valeur), barre d'outils en deux colonnes d'icônes.

## Crédits et liens

Le pied de page et l'écran d'accueil affichent « Réalisé par Erwann avec
Claude Fable 5.1 » et deux liens, LinkedIn et GitHub. Les adresses sont à
renseigner dans `index.html` (deux occurrences, classes `link-linkedin` et
`link-github`).

## Mise en ligne

Le site est statique : `make prod-image` construit une image nginx non
privilégiée qui sert `dist/` (port 8080, `/healthz`), `make prod-run` la lance
sur http://localhost:8081. N'importe quel hébergeur de fichiers statiques ou
n'importe quel cluster capable de lancer cette image convient ; les manifests
de l'instance buildyourtown.com vivent dans un dépôt d'infrastructure séparé.

## Structure

```
Dockerfile   image de production (nginx), Dockerfile.dev pour l'outillage
nginx/       configuration nginx de production
public/      robots.txt, favicon
src/i18n.ts  dictionnaire fr / en et helpers de format
src/game/    état de la ville, terrain, simulation, outils, définitions des bâtiments
src/render/  sprites procéduraux, icônes et rendu isométrique
src/ui/      souris / clavier, HUD (DOM), écran d'accueil, aperçus de cartes
scripts/     simtest.ts, test d'équilibrage headless
```

## Feuille de route

- **Étape 1** (faite) : carte, routes, zones RCI, demande, budget de base.
- **Étape 2** (faite) : électricité, eau simplifiée, services, valeur foncière,
  criminalité, budget détaillé et emprunts, cartes de données, sauvegardes.
- **Étape 3** (faite) : bâtiments 2×2 et 3×3, relief en terrasses,
  terraformage, ponts, variantes de sprites, voitures et eau animées. Pas de
  tunnels : les pentes étant douces, les routes passent partout en rampe.
- **Étape 4** (faite) : trajets domicile-emploi et trafic par case, rail et
  gares, dépôts de bus, autoroutes, port et aéroport. Pas de métro.
- **Étape 5** (faite) : catastrophes, journal et conseils, récompenses et
  arcologies, arrêtés municipaux. Pas de son, jugé inutile.
