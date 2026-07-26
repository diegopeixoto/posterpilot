---
title: Gestionnaire Kometa
description: Gérez le config.yml de Kometa avec un aperçu exact et une confirmation, des diffs caviardés, des écritures atomiques, des sauvegardes horodatées et une restauration prévisualisée.
---

Au-delà de [l'export des visuels sous forme de fichier de métadonnées](/posterpilot/fr/usage/),
PosterPilot peut gérer pour vous **le `config.yml` de Kometa lui-même** — pas
seulement une ou deux sections, mais le fichier entier. Il lit votre configuration
existante, ne met à jour que les parties qui lui appartiennent et réécrit le
fichier en préservant intactes toutes les autres clés et tous les commentaires.

Cette fonction dispose de sa propre page de premier niveau, **`/kometa`**
(l'entrée **Kometa** de la navigation principale), et non d'une section des
paramètres. Elle est facultative et désactivée par défaut : tant que vous
n'indiquez pas un `config.yml` à PosterPilot, rien de votre configuration Kometa
n'est lu ni écrit.

:::note[Deux fichiers Kometa, deux rôles]
PosterPilot touche à deux fichiers différents, faciles à confondre :

- **`posterpilot.yml`** — le fichier de _métadonnées_ que PosterPilot écrit
  lorsque vous appliquez un visuel avec la méthode Kometa. Il contient des
  entrées `url_poster` / `url_background` indexées par identifiant TMDB. Voir
  [Appliquer un visuel](/posterpilot/fr/usage/).
- **`config.yml`** — la configuration de premier niveau _propre_ à Kometa :
  connexions, médiathèques, fichiers de collections, overlays, opérations et
  paramètres. C'est le fichier que gère le **gestionnaire Kometa** décrit sur
  cette page.

Le gestionnaire raccorde le premier fichier _au_ second, pour que Kometa sache
lire `posterpilot.yml`. PosterPilot écrit `posterpilot.yml` dans le **même
répertoire que `config.yml`**, et l'entrée `metadata_files` le référence par son
simple nom de fichier (`posterpilot.yml`) — il n'existe donc qu'un seul fichier et
le raccordement correspond toujours. Aucun chemin de métadonnées ni montage séparé
n'entre en jeu.
:::

## L'activer

Le gestionnaire Kometa est contrôlé par deux réglages, qui suivent tous deux la
même [règle de précédence — l'environnement prime sur l'interface des paramètres](/posterpilot/fr/configuration/)
que le reste de PosterPilot :

| Variable             | Paramètre                | Défaut  | Signification                                                                                                                          |
| -------------------- | ------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `KOMETA_CONFIG_PATH` | Chemin de config Kometa  | —       | Chemin absolu vers le `config.yml` de Kometa. **Vide ou non défini : le gestionnaire Kometa est désactivé.**                            |
| `KOMETA_CONFIG_MODE` | Mode de config Kometa    | `merge` | `merge` (chirurgical — préserve vos autres clés et commentaires) ou `own` (PosterPilot régénère le fichier et en devient propriétaire). |

Pour utiliser le gestionnaire, le répertoire de configuration de Kometa doit
aussi être monté dans le conteneur PosterPilot avec un accès en lecture/écriture —
voir [Monter la configuration de Kometa](/posterpilot/fr/installation/).
Comme `posterpilot.yml` se trouve à côté de `config.yml`, ce seul répertoire
suffit ; il n'y a pas de montage de métadonnées séparé.

## La page /kometa

Le gestionnaire s'ouvre sur un **bandeau vedette cinématographique** — une
bannière d'arrière-plan mettant l'image en avant, avec en surimpression le titre
du gestionnaire et l'état en direct (chemin de la config, mode, dernière
synchronisation, nombre de médiathèques gérées) — pour qu'une surface dédiée à la
configuration porte elle aussi l'identité « les visuels sont la vedette » de
l'application. Les contrôles du chemin de config et du mode, ainsi que les actions
**Prévisualiser** et **Synchroniser**, se trouvent dans l'en-tête juste en
dessous.

Sous ce bandeau, la page s'organise en sous-sections :

1. **Connexions** — des formulaires structurés pour chaque connecteur de service
   Kometa (voir [Ce qui est géré](#ce-qui-est-géré)). Les secrets sont masqués,
   et un test de connexion est proposé là où cela a du sens.
2. **Médiathèques** — pour chaque médiathèque que vous choisissez de gérer : ses
   fichiers de collections, ses overlays par défaut, ses opérations, ses
   surcharges de paramètres propres, et le raccordement des métadonnées
   `posterpilot.yml`. Les médiathèques que vous ne sélectionnez pas restent
   exactement telles quelles.
3. **Paramètres et webhooks** — un ensemble délimité de clés globales `settings:`
   et `webhooks:` que vous pouvez choisir de garder synchronisées.
4. **Config.yml brut** — un éditeur du fichier complet pour tout ce qu'aucun
   formulaire ne couvre, avec les mêmes garde-fous que le parcours structuré
   (analyse-validation → diff → enregistrement).
5. **Sauvegardes** — la liste des sauvegardes horodatées que PosterPilot écrit à
   chaque enregistrement, avec la possibilité d'en **restaurer** n'importe
   laquelle.

Le déroulé habituel : définissez et enregistrez le chemin et la liaison,
remplissez les sections que vous voulez confier à PosterPilot, **prévisualisez
les changements**, puis **confirmez la synchronisation prévisualisée**. La
confirmation n'est activée que pour l'aperçu actuellement affiché.

## Ce qui est géré

PosterPilot n'écrit jamais que les sections qui lui appartiennent ; tout le reste
de `config.yml` est laissé tel quel.

- **Les connecteurs de services** — des formulaires structurés pour `plex`,
  `tmdb`, `tautulli`, `trakt`, `mdblist`, `omdb`, `github`, `radarr`, `sonarr`,
  `notifiarr`, `gotify`, `ntfy`, `anidb` et `mal`. Les blocs `plex` et `tmdb`
  sont préremplis à partir de l'URL de base et du jeton Plex enregistrés dans
  PosterPilot, ainsi que de votre clé TMDB. Kometa ne fonctionne qu'avec Plex, le
  gestionnaire cible donc un serveur Plex.
- **La section `libraries:`** — chaque médiathèque gérée, avec `posterpilot.yml`
  raccordé sous ses `metadata_files` (par son nom de fichier, côte à côte) pour
  que Kometa applique les visuels que vous avez exportés.
- **`collection_files` par médiathèque** — les ensembles de collections par
  défaut que vous activez pour chaque médiathèque.
- **`overlay_files` par médiathèque** — des overlays par défaut tels que
  `mediastinger`, `resolution`, `ribbon`, `audio_codec`, `network` et `ratings`.
- **`operations` par médiathèque** — des bascules telles que `mass_*`,
  `remove_overlays`, `delete_collections` et `assets_for_all`.
- **Les surcharges `settings` par médiathèque** — le petit ensemble de surcharges
  que PosterPilot expose pour une médiathèque gérée.
- **Les clés globales `settings:` et `webhooks:`** — uniquement les clés précises
  que PosterPilot gère, jamais le bloc entier.
- **Tout le reste, via l'éditeur brut** — [l'éditeur `config.yml` brut](#la-page-kometa)
  sert de filet de sécurité, si bien que rien dans votre configuration n'échappe
  à la gestion.

### Vérification de cohérence

Avant d'écrire, PosterPilot exécute une **vérification de cohérence** et vous
avertit lorsqu'un chart ou un overlay activé a besoin d'un connecteur que vous
n'avez pas configuré — par exemple un chart `trakt` ou `tautulli`, ou un overlay
de notes, sans bloc `trakt:` / `tautulli:` correspondant. L'avertissement est non
bloquant (il liste le connecteur manquant aux côtés des éventuels avertissements
d'ancres/alias dans l'aperçu) ; corrigez le connecteur ou poursuivez comme bon
vous semble.

## Sécurité

Le gestionnaire Kometa est conçu pour être non destructif :

- **Fusion chirurgicale (par défaut).** En mode `merge`, PosterPilot ne met à
  jour que les clés qui lui appartiennent et préserve tout le reste — vos
  commentaires et sections non gérées inclus. Désélectionner un élément géré ne
  supprime que l'entrée de PosterPilot, jamais votre contenu. (Le mode `own`,
  activable via `KOMETA_CONFIG_MODE=own`, laisse PosterPilot régénérer le fichier
  et en devenir l'unique propriétaire.)
- **Aperçu avant écriture.** Un diff est toujours affiché d'abord ; rien n'est
  écrit tant que vous ne l'avez pas approuvé. Les secrets sont caviardés dans le
  diff. Le plan émis par le serveur expire et n'est utilisable qu'une seule
  fois ; il est lié à l'empreinte du fichier source, à l'instance Plex
  sélectionnée, au mode de gestion et à l'intégralité du contenu proposé.
  Modifier la moindre entrée invalide l'aperçu affiché.
- **Écritures atomiques avec sauvegarde.** Le nouveau fichier est écrit de façon
  atomique, et la version précédente est conservée à côté sous le nom
  `config.yml.posterpilot-bak-<timestamp>`.
- **Sauvegardes et restauration.** La section **Sauvegardes** liste les
  sauvegardes horodatées. La restauration crée d'abord un diff caviardé exact et
  une confirmation distincte ; la confirmation est rejetée si le fichier actuel
  ou la sauvegarde sélectionnée a changé. Le fichier actuel est sauvegardé avant
  le remplacement atomique.
- **Les ancres et alias sont ignorés.** Toute section utilisant des ancres ou des
  alias YAML (`&` / `*`) est laissée intacte et signalée par un avertissement,
  car une fusion chirurgicale ne peut pas les réécrire sans risque.

:::caution[Kometa a besoin de vos secrets en clair]
Kometa lit le jeton Plex et la clé TMDB depuis `config.yml` en clair ;
PosterPilot **les écrit donc dans `config.yml` — et dans chaque sauvegarde
`config.yml.posterpilot-bak-<timestamp>` — sur le disque.** PosterPilot les
masque dans l'interface et les caviarde dans le diff d'aperçu, mais ils
atterrissent malgré tout sur le volume monté. Assurez-vous que ce fichier et ses
sauvegardes résident sur un stockage digne de confiance, avec des permissions de
système de fichiers appropriées. C'est une propriété de la façon dont Kometa se
configure, pas quelque chose que PosterPilot peut contourner.
:::

## Contrat de l'éditeur brut

**Config.yml brut** charge le fichier complet. **Prévisualiser les changements
bruts** valide d'abord le YAML et crée le diff caviardé exact. Un YAML invalide
ne reçoit aucun plan de confirmation. **Confirmer l'enregistrement brut** est une
action distincte qui n'écrit que le contenu lié à ce plan. Modifier le texte,
changer le fichier source, annuler, l'expiration du plan ou sa réutilisation
l'invalident, et rien n'est écrit.

## Liaison Plex nommée

Kometa ne fonctionne qu'avec Plex. Dans une installation multi-serveur,
choisissez l'instance Plex nommée dans les paramètres ou définissez
`KOMETA_SERVER_INSTANCE_ID`. Chaque aperçu et chaque écriture — structurés ou
bruts — restent liés à cette instance et ne peuvent pas emprunter les
identifiants d'un autre serveur.

Pour les garanties communes de modification et de révision, lisez
[Sécurité, vérification et annulation](/posterpilot/fr/safety/). Pour la
sauvegarde et la restauration au niveau de l'application, voir
[Automatisation et récupération](/posterpilot/fr/automation-recovery/).
