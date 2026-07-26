---
title: Traduire
description: Aidez à traduire l'interface de PosterPilot dans votre langue via Weblate — aucune compétence en code requise.
---

Aidez à traduire l'interface dans votre langue ! Aucune compétence en code n'est
requise. Cette page reflète la section Translators de
[`CONTRIBUTING.md`](https://github.com/diegopeixoto/posterpilot/blob/main/CONTRIBUTING.md#translators).

L'interface est localisée en anglais (la langue par défaut), espagnol, chinois
simplifié, japonais, portugais du Brésil et français, avec un **repli vers
l'anglais clé par clé** : toute chaîne laissée non traduite affiche toujours un
anglais lisible — jamais une clé brute.

## Source de vérité

Chaque chaîne visible par l'utilisateur vit dans un catalogue JSON par langue sous
`messages/` — un fichier par langue, indexé par un id de message stable :

- `messages/en.json` — le catalogue **source** complet (chaque id de message)
- `messages/es.json` — espagnol
- `messages/zh.json` — chinois simplifié
- `messages/ja.json` — japonais
- `messages/pt-BR.json` — portugais du Brésil
- `messages/fr.json` — français

Les autres catalogues contiennent les traductions et peuvent être partiels. Tout
id manquant ou laissé vide dans une langue cible se replie sur son texte anglais.
Les nouvelles chaînes anglaises ajoutées à `en.json` apparaissent automatiquement
comme entrées non traduites pour chaque langue.

## Via Weblate (recommandé)

Les traductions sont gérées via [Weblate](https://hosted.weblate.org/engage/posterpilot/),
une plateforme web libre de traduction, selon un flux de travail basé sur git :

1. Ouvrez le [projet PosterPilot sur Weblate](https://hosted.weblate.org/engage/posterpilot/)
   et connectez-vous — un compte gratuit suffit.
2. Choisissez votre langue et traduisez les chaînes non traduites directement dans
   le navigateur.
3. Weblate propose les modifications au dépôt sous forme de commits/PR via git ;
   un mainteneur les fusionne.

[![État des traductions](https://hosted.weblate.org/widget/posterpilot/multi-auto.svg)](https://hosted.weblate.org/engage/posterpilot/)

Le composant Weblate est configuré sur `messages/*.json` avec `en` comme langue
source et le format JSON (clé-valeur), de sorte qu'il reflète toujours le
catalogue source actuel.

## Via une pull request directe

Vous pouvez aussi modifier un catalogue à la main : copiez une nouvelle clé de
`messages/en.json` vers `messages/<locale>.json`, traduisez la valeur et ouvrez
une PR.

- Gardez les clés identiques à la source ; ne traduisez que les **valeurs**.
- Laissez les noms propres techniques non traduits : **Plex, MediUX, TMDB, Kometa,
  Fanart.tv**.

## Comment la langue active est choisie

La langue active est résolue à chaque requête : (1) votre préférence enregistrée
(définie via le sélecteur d'en-tête ou les paramètres), puis (2) l'en-tête
`Accept-Language` de votre navigateur, puis (3) l'anglais. Consultez
[Configuration → Langue](/posterpilot/fr/configuration/) pour plus de détails.

En contribuant des traductions, vous acceptez que vos contributions soient
publiées sous la [licence MIT](https://github.com/diegopeixoto/posterpilot/blob/main/LICENSE)
du projet.
