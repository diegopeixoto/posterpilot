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

:::note[Configuration et métadonnées ont des rôles distincts]
PosterPilot touche à la configuration de Kometa et à deux fichiers de métadonnées :

- **`posterpilot-movies.yml`** — les visuels de films, indexés par identifiant TMDB,
  avec IMDb comme solution de repli en l'absence d'identifiant TMDB.
- **`posterpilot-shows.yml`** — les visuels de séries, saisons et épisodes,
  indexés par identifiant TVDB, avec IMDb comme solution de repli en l'absence de
  TVDB. Le type enregistré dans PosterPilot choisit l'espace de noms ; une clé
  YAML numérique ne sert jamais à le deviner.
- **`config.yml`** — la configuration de premier niveau _propre_ à Kometa :
  connexions, médiathèques, fichiers de collections, overlays, opérations et
  paramètres. C'est le fichier que gère le **gestionnaire Kometa** décrit sur
  cette page.

Voir [Appliquer un visuel](/posterpilot/fr/usage/) pour savoir comment ces fichiers
de métadonnées sont alimentés.
:::

## L'activer

Le gestionnaire Kometa est contrôlé par deux réglages, qui suivent tous deux la
même [règle de précédence — l'environnement prime sur l'interface des paramètres](/posterpilot/fr/configuration/)
que le reste de PosterPilot :

| Variable                      | Paramètre                            | Défaut   | Signification                                                                                                                          |
| ----------------------------- | ------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `KOMETA_CONFIG_PATH`          | Chemin de config Kometa              | —        | Chemin absolu vers le `config.yml` de Kometa. **Vide ou non défini : le gestionnaire Kometa est désactivé.**                            |
| `KOMETA_CONFIG_MODE`          | Mode de config Kometa                | `merge`  | `merge` (chirurgical — préserve vos autres clés et commentaires) ou `own` (PosterPilot régénère le fichier et en devient propriétaire). |
| `KOMETA_METADATA_PATH_PREFIX` | Préfixe de référence des métadonnées | `config` | Répertoire relatif visible par Kometa à l'exécution ; utilisez `.` (ou videz le champ UI) pour des noms seuls.                          |

Pour utiliser le gestionnaire, le répertoire de configuration de Kometa doit
aussi être monté dans le conteneur PosterPilot avec un accès en lecture/écriture —
voir [Monter la configuration de Kometa](/posterpilot/fr/installation/).

Le chemin physique et la référence Kometa sont délibérément distincts.
PosterPilot écrit les deux fichiers côte à côte dans son répertoire de sortie.
Les valeurs `file:` doivent décrire ces mêmes fichiers depuis la vue du
**runtime Kometa**. Avec le préfixe par défaut, elles valent
`config/posterpilot-movies.yml` et `config/posterpilot-shows.yml`, même si un
montage portant un autre nom place physiquement les fichiers à côté de
`config.yml`. Le préfixe est relatif : n'utilisez ni chemin hôte, ni chemin absolu
du conteneur, ni URL, ni nom de fichier YAML.

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
   surcharges de paramètres propres, et le raccordement des métadonnées typées.
   Les médiathèques que vous ne sélectionnez pas restent
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
- **La section `libraries:`** — chaque médiathèque gérée, avec la référence
  `posterpilot-movies.yml` ou `posterpilot-shows.yml` appropriée sous ses
  `metadata_files`, afin que Kometa applique les visuels exportés.
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

## Migrer l'ancien posterpilot.yml

:::caution[Attendez la publication]
Ne renommez, ne scindez et ne raccordez pas `posterpilot.yml` à la main. Attendez
que la version PosterPilot contenant cette migration soit publiée dans
[Releases](https://github.com/diegopeixoto/posterpilot/releases), mettez votre
instance à niveau, puis utilisez la migration affichée dans `/kometa`.
:::

Une installation existante peut mélanger films et séries dans un unique
`posterpilot.yml`, comme s'ils partageaient l'espace TMDB. La migration le normalise :

1. **Aperçu.** PosterPilot compare le fichier hérité à la médiathèque Plex liée et
   à son historique exact de révisions. L'aperçu ne montre que la structure, des
   empreintes et des totaux — jamais d'URL de visuel ni d'identifiants secrets.
   Les films utilisent TMDB avec IMDb comme solution de repli ; les séries, TVDB
   avec le même repli vers IMDb.
2. **Ambiguïtés.** Une clé numérique pouvant désigner plusieurs types,
   PosterPilot ne devine jamais. Les entrées sans preuve sont isolées. Vous pouvez
   corriger la correspondance ou accepter explicitement l'ambiguïté, terminer,
   puis réappliquer ces visuels dans PosterPilot ; ils seront alors écrits dans le
   bon fichier typé. Une entrée typée existante en conflit n'est pas écrasée.
3. **Confirmation.** Un journal durable et des sauvegardes protégées sont d'abord
   enregistrés. PosterPilot écrit et vérifie **les deux** fichiers typés, puis
   modifie `config.yml` en dernier. L'ancien `posterpilot.yml` n'est jamais
   modifié ni supprimé.
4. **Nouvelle tentative et reprise.** Après une interruption, réessayer reprend au
   point de contrôle vérifié, sans reclassification. Si un fichier ne correspond
   plus ni à l'empreinte prévisualisée ni au résultat déjà écrit, l'opération
   s'arrête pour un nouvel examen au lieu de l'écraser.

Si PosterPilot peut prouver qu'il gère les entrées `metadata_files`, il raccorde
automatiquement `config.yml`. Sinon, il écrit les fichiers typés et fournit un
guide exact par médiathèque. **Ne collez pas ce bloc `libraries:` partiel par-dessus
votre configuration.** Dans chaque médiathèque indiquée, remplacez uniquement
l'élément `metadata_files` dont le basename de `file` est `posterpilot.yml` ; s'il
n'existe pas, ajoutez une seule fois l'élément typé affiché. Conservez tous les
éléments voisins et réglages de la médiathèque, puis terminez avec exactement une
référence typée et aucune référence héritée active. Vérifiez les chemins depuis le runtime Kometa avant
d'accuser réception de la fin dans PosterPilot. Cet accusé enregistre votre
déclaration ; il ne prétend pas que PosterPilot a vérifié la modification manuelle.

**Rollback** restaure la sauvegarde protégée de `config.yml` uniquement si la
configuration actuelle correspond encore exactement au résultat de la migration.
Les fichiers typés et le fichier hérité sont conservés : les visuels générés ne
sont pas perdus et une nouvelle tentative n'a pas à les reconstruire.

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
