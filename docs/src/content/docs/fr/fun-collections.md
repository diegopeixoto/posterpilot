---
title: Expériences FUN et collections
description: Utilisez les outils FUN optionnels et les espaces de travail de cohérence des collections sans contourner la révision ni les garde-fous d'application.
---

FUN et les Collections réutilisent votre médiathèque synchronisée. Aucune de ces
deux zones n'invente l'identité des médias, et aucune n'applique de visuels
simplement parce qu'elle a trouvé un résultat ou une famille visuelle.

## Activer FUN

Définissez `FUN_ENABLED=true` ou activez **FUN** dans les paramètres. Lorsqu'il est
désactivé, l'entrée de navigation est masquée et les routes `/fun` renvoient une
erreur « introuvable ».

Tous les filtres FUN sont limités au serveur nommé actif. Un décompte exact des
titres éligibles s'affiche avant le tirage ; les plages d'années, de durées ou de
notes invalides doivent être corrigées plutôt que d'être élargies en silence.

## Sélecteur de soirée

Le sélecteur renvoie jusqu'à trois choix distincts issus du bassin éligible.
Filtrez par médiathèque, type de média, genre, année, statut vu/non vu, durée,
note minimale, récence ou préréglage. Un tirage enregistre sa graine, ses filtres
normalisés et les identifiants sélectionnés dans l'URL, de sorte que
l'actualisation, le bouton Retour et le partage reproduisent le même ordre tant
que ces éléments existent encore.

Relancer le tirage conserve les filtres et utilise une nouvelle graine.
PosterPilot évite l'historique de session récent et borné lorsqu'il existe assez
d'alternatives ; avec un petit bassin, il n'assouplit que l'évitement des
répétitions, jamais vos filtres. Le mode à l'aveugle masque l'identité jusqu'à la
révélation, et les capsules exposent leur règle d'éligibilité avant le tirage.

![Sélecteur de soirée FUN de PosterPilot avec des filtres de médiathèque, de type de média, de genre, d'année, de durée et de note avant le tirage d'un titre](/posterpilot/screenshots/fun-picker.webp)

## Poster Match

Poster Match nécessite un titre avec au moins deux candidats d'affiche
disponibles. Choisissez entre deux images à la fois jusqu'à ce qu'un tournoi fini
désigne un gagnant. Les candidats défectueux sont retirés du duel en cours lorsque
c'est possible. Le gagnant conserve la provenance de son fournisseur et est
**préparé** sur l'élément ; utilisez l'aperçu et la confirmation habituels pour
l'appliquer.

## Galerie ambiante

La galerie plein écran peut afficher des affiches, des arrière-plans ou les deux,
avec des filtres de médiathèque et de type de média. Utilisez les commandes
précédent/suivant, pause/reprise, intervalle et sortie ; les équivalents clavier
restent disponibles. Avec `prefers-reduced-motion: reduce`, la lecture automatique
démarre en pause jusqu'à ce que vous la repreniez explicitement pour cette
session. Les images qui ne se chargent pas sont ignorées pour la session.

## Planificateur de séance

Choisissez deux ou trois films et un budget de durée. Le planificateur utilise des
films distincts dont la durée connue est positive, respecte les filtres de
médiathèque, de genre, de statut vu et de note, et ne renvoie jamais un plan qui
dépasse le budget. **Replanifier** conserve les contraintes et change la graine.
Si aucune combinaison ne convient, modifiez le budget ou les filtres.

## Collections et franchises

Les collections sont des espaces de travail limités à un serveur, construits à
partir de l'appartenance native côté fournisseur et des identités TMDB
`belongs_to_collection`. Des collections portant le même nom sur des serveurs
différents restent séparées, et la simple similarité des titres ne crée jamais
d'appartenance.

L'index des collections inclut les groupes comptant au moins deux membres locaux.
La vue de détail montre :

- la provenance native/TMDB et les membres TMDB indisponibles à titre de contexte ;
- l'état actuel et préparé de l'affiche et de l'arrière-plan pour chaque membre
  local ;
- les indices connus de fournisseur, de set, d'auteur, de langue ou de famille de
  design ;
- une cohérence et une couverture explicables, la provenance inconnue restant
  distincte d'une discordance délibérée.

## Suggestions coordonnées et remplacements

Lorsque des indices de famille vérifiables couvrent plusieurs membres, PosterPilot
classe les familles par couverture et par score des visuels. Une suggestion montre
les membres et emplacements couverts et non couverts. La préparer ne modifie que
les emplacements couverts. Vous pouvez remplacer ou effacer chaque membre et
chaque emplacement indépendamment.

Si aucun indice commun n'existe, la page propose des candidats par membre sans
prétendre à un set coordonné. Les candidats de fournisseur périmés sont signalés.

## Appliquer et annuler les collections

La préparation d'une collection reste une préparation d'éléments ordinaire.
Utilisez un aperçu exact de la collection avant de confirmer toute écriture
coordonnée : le plan fige l'appartenance, les identifiants des membres, les
emplacements, les destinations, les sélections, l'état actuel et les éléments
ignorés. Un changement d'appartenance ou de sélection l'invalide. Les résultats
restent par membre et par destination, si bien que les réussites indépendantes ne
sont pas masquées par un seul échec.

Une action de collection ne peut être annulée que via son groupe de révisions
correspondant et un nouvel aperçu d'annulation. Les révisions individuelles des
membres peuvent aussi être traitées depuis l'historique de l'élément. Si
l'interface actuelle n'expose pas d'action coordonnée pour une capacité, ouvrez
l'élément membre et utilisez ses commandes standard de révision, d'application et
d'annulation ; ne supposez pas que la préparation ait écrit quoi que ce soit.

Consultez [Sécurité, vérification et annulation](../safety/) avant d'appliquer,
et [Utilisation](../usage/) pour la révision et le détail des tâches.
