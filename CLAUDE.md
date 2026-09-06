# BuildYourTown — conventions du projet

Complète les préférences globales (`~/.claude/CLAUDE.md`). Tout l'outillage passe
par Docker (`make build`, `make simtest`, `make dev`), rien n'est installé sur la
machine. Version dans `package.json`, publication par `scripts/release.sh`.

## Sprites : ordre de dessin, calques, décalages

Les sprites sont dessinés à la volée dans `src/render/sprites.ts` et mis en cache
par clé (`SpriteCache.get(key)`). On a eu plusieurs fois des incohérences
visuelles (volumes qui se traversent, éléments peints par-dessus ce qui est
devant eux, objets décalés d'une case). Règles à respecter, dans l'ordre :

1. **Une `Scene` trie ses éléments par `key` croissante**, et c'est tout ce
   qui décide de ce qui recouvre quoi. Clés par défaut : `box` = `u0 + v0`
   (+10 si `z0 > 0`), `cylinder` = `u − r + v − r` (+10 si `z0 > 0`),
   `dome` = `u + v + 10`, `disc` = −1, `custom(key)` explicite. La profondeur
   écran est `u + v` : **tout élément dont `u + v` est plus grand que celui
   d'un voisin qu'il chevauche à l'écran doit avoir une clé plus grande.**
   Un élément surélevé (`z0 > 0`) gagne +10 : un élément au sol placé devant
   lui serait donc repeint par-dessus. Dès que l'ordre par défaut ne convient
   pas, donner une clé explicite (`{ key: 45 }`, `50`, `51`…) aux éléments de
   devant, et une petite (`0.5`) à ceux de derrière.
2. **Jamais de volumes qui se traversent ni à cheval sur une paroi.** Avant
   d'écrire une recette, vérifier les emprises : cylindre = disque de rayon
   `r`, boîte = rectangle ; deux emprises ne se recouvrent pas, avec 0,05 de
   marge. Un objet à moitié dans un hangar sera peint par-dessus le mur.
3. **Dalle sur poteaux** : donner à la dalle une clé supérieure aux poteaux,
   sinon on voit les pieds par transparence.
4. **Orientation** : un sprite orienté (port, gare) reçoit son côté dans la
   clé et le renderer le calcule (`portSide`, `stationAlongY`). Vérifier les
   quatre orientations, pas une seule.
5. **Tout ce qui varie d'une case à l'autre doit être dans la clé** (masque de
   voisinage, pente `pat`, variante, altitude, animation). Un état lu ailleurs
   que dans la clé ne sera jamais redessiné.
6. **Joints entre cases** : un contour tracé sur le bord d'un losange déborde
   d'un demi-pixel sur la case voisine peinte avant. Pour sceller sans
   déborder, tracer à l'intérieur d'un `clip` sur le losange, largeur 2.
7. **Effets** (`smoke`, `beacon`, `signal`, `xing`) sont enregistrés pendant
   le dessin du sprite (`currentEffects`) et dessinés par le renderer par-
   dessus, après voitures et véhicules. Sur un tablier au-dessus d'une route,
   dessiner les voitures **avant** le sprite du tablier.
8. **Vérifier en jeu, pas sur l'icône** : capture headless (Chrome dans Docker,
   `--virtual-time-budget`) d'une scène de test au zoom 3, avec un hook
   temporaire `// X-DEBUG` dans `src/main.ts` **toujours retiré ensuite**.
   `requestAnimationFrame` ne tourne qu'une fois en headless : appeler
   `render(performance.now())` dans le hook, et positionner les marcheurs
   (`walker.hist`) à la main s'il faut un train ou un bateau.
9. **Pièges de scène de test** : deux voies parallèles adjacentes se raccordent
   par leurs masques (boucles), une case bâtie reprend son losange entier,
   les catastrophes visent une zone développée (le centre de la carte s'il n'y
   en a pas).

## Règles de jeu à ne pas réintroduire

- Une case de terre reste un losange entier à l'écran (lisibilité de ce qui
  est constructible) : pas de découpe en biais des cases de terre.
- Aucun croisement ni embranchement sur un pont (rail × route, route × route,
  rail × rail).
- Toute « sélection automatique » d'outil doit contourner la bascule
  « outil actif → loupe » (`setTool(tool, false)`).
