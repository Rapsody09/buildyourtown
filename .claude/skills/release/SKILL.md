---
name: release
description: Publier une nouvelle version de BuildYourTown de bout en bout — notes de version, bump (patch/minor/major), README, commit et tag, build et push de l'image, redéploiement, vérification du site. À utiliser quand l'utilisateur veut « sortir une version », « déployer la mise à jour », « faire une release », « mettre en ligne ».
---

# Release BuildYourTown

Argument optionnel : `patch` (défaut), `minor`, `major` ou une version explicite `X.Y.Z`.
Règle : correctif ou réglage → patch ; nouvelle fonctionnalité visible → minor ;
changement de sauvegarde incompatible ou refonte → major.

## Déroulé

1. **État du dépôt.** `git status`. Tout ce qui doit partir dans la version doit
   être commité avant le bump (le script refuse un arbre sale). Si des
   changements traînent, les commiter avec un message décrivant le contenu,
   jamais de référence à un assistant dans le message.
2. **Matière pour les notes.** `git log --oneline $(git describe --tags --abbrev=0)..HEAD`
   et, si besoin, `git diff --stat`. Regrouper par thème pour le joueur :
   gameplay, interface, équilibrage, corrections. Pas de détail technique
   interne, pas de nom de fichier.
3. **Notes de version.** Calculer la nouvelle version à partir de
   `package.json` et du bump, puis ajouter en tête de `CHANGELOG.md` une
   section `## X.Y.Z — AAAA-MM-JJ` (date du jour) avec des puces courtes, en
   français. Une puce = un changement perceptible.
4. **Script.** `scripts/release.sh <bump>` fait le reste : bump dans
   `package.json` et `package-lock.json` (npm dans le conteneur), ligne
   « Version » du README, typecheck + build, captures du README régénérées
   (`scripts/screenshots.sh`, badge à la nouvelle version), commit `release: vX.Y.Z`, tag
   `vX.Y.Z`, push avec le tag, puis `~/infra/scripts/build-push-buildyourtown.sh`
   (build de l'image, push `:latest` + `:vX.Y.Z` + `:<sha>` sur la registry,
   `rollout restart`) et contrôle que le site sert la nouvelle version.
   Pré-requis : être sur le réseau autorisé par la registry, login Docker déjà
   fait, kubeconfig du cluster en place. `--no-deploy` pour s'arrêter après le push Git.
5. **Vérifier et rendre compte.** Si le script s'est arrêté, dire à quelle
   étape et pourquoi, sans relancer à l'aveugle. Sinon donner : version,
   tag, tags d'image, résultat du contrôle en ligne, et un lien vers la
   section du CHANGELOG. Proposer un rollback si quelque chose cloche :
   `kubectl -n buildyourtown set image deploy/buildyourtown-web web=registry.vadro.fr/buildyourtown/web:v<précédente>`.

## Ce que le skill ne fait pas

- Pas de release GitHub ni de changement d'infrastructure : les manifests
  Kubernetes vivent dans le dépôt infra et ne bougent pas pour une version.
- Pas de modification de la difficulté ou de l'équilibrage « au passage » :
  une release publie ce qui est déjà dans `main`.
