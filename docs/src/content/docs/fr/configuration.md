---
title: Configuration
description: Connectez un serveur multimédia, définissez votre clé TMDB, activez les fournisseurs de visuels, configurez l'export Kometa et consultez la référence complète des variables d'environnement.
---

PosterPilot se configure de deux manières, qui fonctionnent de concert :

- **Les variables d'environnement** — définies sur le conteneur. Idéales pour les
  installations sans intervention et la gestion des secrets.
- **La page Paramètres de l'application** — les valeurs saisies dans l'interface
  sont persistées dans la base de données SQLite sous `/data`, et survivent donc
  aux redémarrages. Les paramètres sont organisés en **Serveurs**, **Métadonnées et
  fournisseurs**, **Kometa et avancé**, **Diagnostics**, **Sauvegarde et
  restauration**, **Automatisation**, **Sécurité**, **Langue** et **Activité**.
  La gestion du `config.yml` propre à Kometa se fait sur sa propre
  [page du gestionnaire Kometa](/posterpilot/fr/kometa-config-sync/)
  (l'entrée **Kometa** de la navigation principale), pas dans les paramètres. Un
  [assistant de première installation](/posterpilot/fr/installation/) guidé, accessible
  à `/setup`, couvre les mêmes étapes dans l'ordre pour une installation neuve.

## Environnement ou interface des paramètres

Pour un paramètre donné, **la variable d'environnement a toujours priorité** sur
la valeur persistée dans l'interface. Quand une valeur provient de
l'environnement, la page Paramètres l'affiche comme _gérée par l'environnement_
et la verrouille en édition — la source de vérité est donc sans ambiguïté.

Si une valeur n'est définie à aucun des deux endroits, la valeur par défaut
documentée (le cas échéant) s'applique, ou la fonctionnalité qui en dépend reste
non configurée jusqu'à ce que vous la renseigniez.

Les secrets (le jeton Plex, les clés API Jellyfin/Emby, la clé TMDB et la clé
Fanart.tv) ne sont jamais renvoyés au navigateur après leur enregistrement et
sont caviardés dans les journaux — la page Paramètres indique seulement qu'un
secret _est défini_.

## Secrets et chiffrement

Ces mêmes secrets — le jeton Plex, les clés API / jetons d'accès Jellyfin et
Emby, la clé TMDB et la clé Fanart.tv — sont **chiffrés au repos** en
AES-256-GCM avant d'être écrits dans la base de données SQLite. Chaque valeur
stockée est auto-descriptive (elle porte le préfixe `enc:v1:`), ce qui permet à
PosterPilot de distinguer les valeurs chiffrées de l'ancien texte en clair.

- **Aucune configuration par défaut.** Au premier démarrage, PosterPilot génère
  une clé d'instance aléatoire de 32 octets et la persiste — lisible par son seul
  propriétaire — dans `data/.app-key`. Rien à configurer : les secrets sont
  chiffrés automatiquement. (Remplacez le chemin avec `APP_KEY_FILE` si besoin.)
- **Clé portable pour les déploiements partagés.** Définissez la variable
  d'environnement facultative `APP_SECRET` pour dériver la clé d'une valeur que
  vous contrôlez (de façon déterministe, via scrypt). Utilisez-la quand plusieurs
  répliques partagent une même base de données, ou quand vous voulez que la même
  clé survive à la recréation du conteneur sans avoir à transporter le fichier de
  clé. Quand `APP_SECRET` est définie, elle a priorité sur le `data/.app-key`
  généré.
- **Les installations existantes ne sont pas cassées.** Les secrets enregistrés
  en clair par une version antérieure sont lus de façon transparente et
  rechiffrés au prochain enregistrement de ce paramètre — aucune ressaisie
  manuelle n'est nécessaire.
- **Échec sans casse.** Si un secret ne peut pas être déchiffré (par exemple si
  la clé a été perdue ou modifiée), PosterPilot le considère comme non défini et
  vous invite à le ressaisir plutôt que de planter.

:::caution
Si vous vous reposez sur le `data/.app-key` généré automatiquement (sans
`APP_SECRET`), **sauvegardez le volume `/data`** — si le fichier de clé est
perdu, les secrets chiffrés ne peuvent plus être déchiffrés et devront être
ressaisis. Définir `APP_SECRET` (et la conserver en lieu sûr) évite ce risque et
garde les secrets portables lors de la recréation du conteneur et entre
répliques.
:::

## Authentification

PosterPilot est livré **sans identification par défaut** — sur un réseau local
de confiance, il ne se met pas en travers de votre chemin. Quand vous l'exposez,
vous pouvez exiger une connexion, à la façon des applications *arr
(Sonarr/Radarr), avec un contournement facultatif pour le réseau local.
Configurez-la dans **Paramètres → Sécurité**, ou verrouillez le mode depuis
l'environnement avec `AUTH_MODE`.

Trois modes :

- **`disabled`** (par défaut) — pas de connexion ; toutes les routes sont
  ouvertes.
- **`local`** — une connexion est exigée, **sauf** pour les adresses du réseau
  local (boucle locale, RFC1918, lien local, ULA IPv6). Les clients du LAN ne
  voient jamais d'invite ; tous les autres doivent se connecter. Les adresses
  locales contournent toujours l'identification — il n'y a pas de déconnexion
  pour l'accès LAN dans ce mode.
- **`enabled`** — une connexion est exigée pour chaque requête.

Définissez un nom d'utilisateur et un mot de passe dans l'onglet Sécurité. Le
mot de passe n'est stocké que sous forme de hachage **scrypt** salé (jamais en
clair, jamais récupérable), distinct de la clé de chiffrement des secrets, si
bien qu'il ne dépend jamais de `.app-key`. La session est un cookie signé
`HttpOnly` à expiration glissante de 14 jours ; changer le mot de passe
invalide toutes les sessions existantes.

![Paramètres de sécurité de PosterPilot avec les modes d'authentification désactivé, contournement local et activé](/posterpilot/screenshots/settings-security.webp)

### Derrière un proxy inverse

Le mode `local` est **fermé par défaut** (fail-closed) : si une requête porte un
en-tête `X-Forwarded-For` / `Forwarded` mais que vous n'avez **pas** indiqué à
PosterPilot quel en-tête approuver, elle est traitée comme **non locale** et
doit s'authentifier. Sans cela, un proxy — dont l'IP de socket est généralement
privée — ferait passer tout le trafic Internet pour du trafic local. Configurez
les mécanismes intégrés d'adapter-node pour que la véritable IP du client soit
utilisée :

- `ADDRESS_HEADER=x-forwarded-for`
- `XFF_DEPTH=<number of trusted proxies in front of the app>`

Un client LAN en accès direct n'envoie jamais d'en-tête de transfert, donc il
bénéficie toujours correctement du contournement.

### Anti-verrouillage

`AUTH_MODE` dans l'environnement **écrase** le mode persisté et verrouille le
contrôle dans l'interface. Définissez `AUTH_MODE=disabled` pour récupérer une
instance dont vous vous êtes vous-même verrouillé l'accès. Comme filet de
sécurité supplémentaire, si le mode est `enabled`/`local` mais qu'aucun
identifiant n'est stocké, PosterPilot retombe sur `disabled` plutôt que de
laisser tout le monde à la porte.

:::note
Activer l'authentification est une mise à niveau **sans rupture** : la valeur
par défaut est `disabled`, donc les installations existantes se comportent
exactement comme avant tant que vous n'activez rien. Il n'y a aucune migration
de données ni aucun changement dans la façon dont le conteneur s'exécute.
:::

## Serveurs multimédias nommés

PosterPilot peut stocker plusieurs instances Plex, Jellyfin et Emby nommées. Une
seule instance activée est active à la fois pour la médiathèque, la révision,
les collections, FUN, les tâches et les mutations. Ajoutez et testez des
instances dans **Paramètres → Serveurs** ; avec deux instances activées ou plus,
l'interface de l'application affiche aussi un sélecteur.

`SERVER_TYPE` plus `PLEX_*`, `JELLYFIN_*` ou `EMBY_*` restent la forme
« environnement » de l'instance héritée/par défaut protégée. À la mise à niveau,
les données mono-serveur existantes sont rattachées sur place à cette instance
nommée. Les serveurs supplémentaires sont stockés séparément, avec des
identifiants chiffrés ; les variables héritées ne définissent pas une liste de
serveurs. Voir [Migration multi-serveur](../multi-server-migration/).

Chaque serveur annonce ses propres capacités. L'aperçu désactive ou ignore les
opérations non prises en charge — affiche, arrière-plan, saison, épisode,
lecture, verrouillage ou suppression — au lieu de supposer que chaque version de
Plex/Jellyfin/Emby se comporte à l'identique.

### Plex

Plex a besoin d'une URL de base et d'un `X-Plex-Token`. Vous pouvez les fournir
de trois manières :

- **Connexion par PIN (recommandée).** Dans les paramètres, lancez une connexion
  Plex. PosterPilot crée un PIN fort auprès de plex.tv, vous montre un code et un
  lien d'autorisation, puis interroge plex.tv jusqu'à ce que vous l'autorisiez —
  il stocke alors le jeton obtenu pour vous, si bien que vous n'avez jamais à
  trouver et coller un jeton brut. Si le PIN expire avant votre autorisation,
  relancez simplement une connexion.
- **Découverte des connexions.** Une fois un jeton disponible, PosterPilot peut
  découvrir vos serveurs Plex et leurs connexions depuis plex.tv, en étiquetant
  chaque connexion **locale** ou **distante** (les relais sont signalés).
  Choisissez-en une au lieu de saisir une URL ; la connexion choisie est vérifiée
  par un test de connexion avant d'être enregistrée comme URL de base Plex
  active.
- **Manuelle.** Collez directement l'URL de base
  (p. ex. `http://192.168.1.10:32400`) et un `X-Plex-Token`.

### Jellyfin

Jellyfin a besoin d'une URL de base (`JELLYFIN_URL`) et d'un jeton d'accès,
stocké comme clé API (`JELLYFIN_API_KEY`). Définissez `SERVER_TYPE=jellyfin`
pour en faire le serveur actif. Le plus simple pour vous connecter est de **vous
identifier avec votre nom d'utilisateur et votre mot de passe Jellyfin** dans
les paramètres — PosterPilot s'authentifie auprès du serveur et stocke pour vous
le jeton d'accès renvoyé (chiffré au repos), si bien que vous n'avez jamais à
générer une clé API à la main ; le mot de passe ne sert qu'à cette unique
requête et n'est jamais persisté. Coller directement une clé API reste possible
en solution de repli. Les affiches et les arrière-plans sont téléversés vers
l'API d'images de Jellyfin (`Primary` pour l'affiche, `Backdrop` pour
l'arrière-plan). Il n'y a ni connexion par PIN ni découverte des connexions
comme pour Plex.

:::note
Le chemin Plex est le plus éprouvé ; les intégrations Jellyfin et Emby sont plus
récentes. Elles s'exécutent derrière la même interface de serveur multimédia,
donc la synchronisation, la découverte et l'application fonctionnent à
l'identique — mais si vous rencontrez une bizarrerie propre à un serveur, merci
d'ouvrir un ticket.
:::

### Emby

Emby a besoin d'une URL de base (`EMBY_URL`) et d'un jeton d'accès, stocké comme
clé API (`EMBY_API_KEY`). Définissez `SERVER_TYPE=emby` pour en faire le serveur
actif. Comme Jellyfin, Emby vous laisse **vous identifier avec votre nom
d'utilisateur et votre mot de passe** — PosterPilot les échange contre un jeton
d'accès et le stocke (chiffré) pour que vous n'ayez pas à chercher une clé API,
la saisie manuelle d'une clé API restant disponible en repli. Il n'y a ni
connexion par PIN ni découverte des connexions.

## Clé TMDB

Un identifiant d'API [TMDB](https://www.themoviedb.org/) est requis :
PosterPilot résout chaque titre synchronisé vers un identifiant TMDB (afin
d'interroger les fournisseurs avec précision), et TMDB est aussi l'un des
fournisseurs de visuels. Définissez-le via `TMDB_KEY` ou dans les paramètres.
Une **clé API v3** comme un **jeton bearer/JWT v4** sont acceptés — le format
est détecté automatiquement.

## Fournisseurs de visuels

Pendant la découverte, PosterPilot interroge plusieurs fournisseurs de visuels
en parallèle et fusionne leurs candidats, en étiquetant chacun avec le
fournisseur dont il provient. Chaque fournisseur peut être activé ou désactivé
indépendamment, dans les paramètres ou via sa variable d'environnement.

| Fournisseur     | Par défaut | Clé requise          | Notes                                                                              |
| --------------- | ---------- | -------------------- | ---------------------------------------------------------------------------------- |
| **MediUX**      | activé     | non                  | Sets d'affiches/arrière-plans collectés, avec attribution du contributeur.         |
| **TMDB**        | activé     | réutilise `TMDB_KEY` | Affiches et arrière-plans issus du point de terminaison d'images de TMDB.          |
| **Fanart.tv**   | désactivé  | `FANART_KEY`         | Affiches, arrière-plans et logos issus de l'API Fanart.tv.                         |
| **ThePosterDB** | désactivé  | non                  | Sets communautaires d'affiches/arrière-plans collectés, avec limitation de débit et cache. |

Fanart.tv est le seul fournisseur à clé : s'il est activé mais qu'aucune
`FANART_KEY` n'est configurée, la découverte l'ignore et signale l'absence
d'identifiant au lieu de faire échouer toute l'exécution. Une panne, un délai
dépassé ou une réponse inexploitable chez un fournisseur n'empêche jamais les
autres de renvoyer des candidats.

## Performance et réglages

Une poignée de paramètres avancés (dans l'onglet **Kometa et avancé** des
paramètres, ou via l'environnement) règlent la façon dont PosterPilot note,
synchronise, applique et met en cache. Ils suivent la précédence habituelle —
une variable d'environnement écrase la valeur persistée et verrouille le
contrôle dans l'interface.

- **Visuels suggérés** (`SUGGEST_PRESELECT`, activé par défaut). Quand il est
  actif, les vues d'élément et de révision calculent et étiquettent le candidat
  le mieux noté pour chaque emplacement. Accepter ou préparer cette suggestion
  reste une action explicite ; le chargement de la page ne persiste rien en
  silence. Désactivez-le pour masquer les suggestions automatiques.
- **Poids de notation.** PosterPilot classe les candidats sur trois termes — un
  poids de base par fournisseur (MediUX, ThePosterDB, Fanart.tv, TMDB), un score
  de résolution et un score d'adéquation du format (2:3 pour les affiches, 16:9
  pour les arrière-plans et les cartes de titre). Les valeurs par défaut
  favorisent MediUX tout en laissant gagner une image nettement plus fine ou
  mieux proportionnée venue d'un autre fournisseur. Ajustez les poids dans les
  paramètres ; ils sont stockés dans la base de données et n'ont pas de variable
  d'environnement.
- **Synchronisation incrémentale** (`INCREMENTAL_SYNC`, activée par défaut).
  Les synchronisations suivantes ignorent les éléments dont l'horodatage de
  dernière modification côté serveur multimédia n'a pas changé depuis la
  dernière synchronisation. Une réanalyse complète reste disponible à la
  demande.
- **Concurrence d'application** (`APPLY_CONCURRENCY`, `4` par défaut). Le
  nombre d'éléments qu'une application en masse traite en même temps.
  Augmentez-la pour terminer plus vite les gros lots ; réduisez-la pour ménager
  votre serveur et les fournisseurs.
- **Cache de miniatures** (`THUMB_CACHE_TTL_DAYS`, `30` par défaut ;
  `THUMB_CACHE_MAX_MB`, `512` par défaut). Les images d'aperçu des fournisseurs
  sont mises en cache sur disque sous `/data` pour accélérer la grille et
  réduire la bande passante consommée chez les fournisseurs. Les entrées sont
  réutilisées jusqu'à l'expiration du TTL (en jours), et le cache est borné par
  une taille maximale (en Mo) — une fois celle-ci dépassée, les entrées les
  moins récemment utilisées sont évincées.
- **Tri par défaut de la médiathèque** (`LIBRARY_DEFAULT_SORT`, `title` par
  défaut). Le tri avec lequel s'ouvre le mur de la médiathèque quand l'URL n'en
  précise pas un : `title`, `year`, `rating`, `runtime`, `recent` (modifiés
  récemment) ou `added` (date d'ajout sur le serveur multimédia). Choisir un tri
  dans la barre d'outils de la médiathèque a toujours priorité.

## La section FUN

**FUN** (`FUN_ENABLED`, désactivée par défaut) est un espace optionnel qui
regroupe le sélecteur à trois choix, les choix à l'aveugle/capsules, Poster
Match, la galerie ambiante et le planificateur de session à budget de durée.
Tant qu'elle est désactivée, FUN n'a pas d'entrée de navigation et ses routes
renvoient 404. Voir [Expériences FUN et collections](../fun-collections/).

## Automatisation orientée révision

**Paramètres → Automatisation** gère des planifications nommées pour le serveur
actif. Chacune est limitée aux médiathèques sélectionnées et peut utiliser un
intervalle, une heure locale quotidienne ou un déclencheur d'événement
(`new_items` ou `sync_completed`). Choisissez `sync` ou `sync_discover`, un
fuseau horaire IANA, une vue de révision enregistrée facultative, une fenêtre de
rattrapage et un seuil de pause après échec. Ces enregistrements sont persistés
séparément des valeurs par défaut globales.

Les automatisations sont limitées à la révision : elles synchronisent et
découvrent éventuellement des candidats, mais ne créent jamais de tâche
d'application. Les jetons de webhook sont générés par automatisation et affichés
une seule fois. Voir [Automatisation et récupération](../automation-recovery/).

## Sauvegarde, restauration et diagnostics

**Paramètres → Sauvegarde et restauration** crée des lots gérés par
l'application dans le répertoire dérivé de `DATABASE_URL` (normalement
`/data/backups`). La rétention par nombre maximal et/ou par ancienneté est
stockée dans la base de données ; elle ne se configure pas pour l'instant par
variable d'environnement. Les sauvegardes peuvent être validées, exportées
explicitement, supprimées ou restaurées, moyennant une vérification préalable et
une confirmation. La restauration exige un redémarrage du conteneur une fois la
sauvegarde de sécurité protégée et le marqueur préparés.

**Paramètres → Diagnostics** vérifie chaque serveur, TMDB, chaque fournisseur et
les chemins configurés (données/Kometa/sauvegardes) sans rien modifier, et peut
exporter explicitement un lot de support caviardé. Voir
[Automatisation et récupération](../automation-recovery/) pour les modes de clé,
l'état de préparation à la restauration et le retour en arrière.

## Export Kometa

Quand vous appliquez une couverture avec la méthode Kometa, PosterPilot écrit du
YAML compatible Kometa/PMM (`url_poster` / `url_background`, indexé par
identifiant TMDB) dans le répertoire désigné par `KOMETA_ASSETS_DIR` (par défaut
`/kometa` dans Docker). Si `KOMETA_CONFIG_PATH` est défini, le répertoire de
sortie effectif est celui qui contient ce `config.yml`, ce qui garde
`posterpilot.yml` au même endroit. Montez-le en lecture/écriture pour que Kometa
puisse consommer le fichier à sa prochaine exécution. Voir
[Utilisation](../usage/).

Cet export est un fichier de _métadonnées_. PosterPilot peut aussi gérer
chirurgicalement le **`config.yml` propre** de Kometa — chaque connecteur de
service, les collections par médiathèque, les overlays et opérations, les
paramètres globaux et les webhooks, plus un éditeur brut pour tout le reste — et
y raccorder `posterpilot.yml` pour vous (placé dans le même répertoire que
`config.yml`). Tout cela vit sur sa propre
[page du gestionnaire Kometa](/posterpilot/fr/kometa-config-sync/).

![Gestionnaire Kometa de PosterPilot montrant le chemin de configuration, le mode de gestion et les sections de connexion](/posterpilot/screenshots/kometa-manager.webp)

## Langue

La langue de l'interface est résolue à chaque requête : (1) le paramètre de
langue préférée quand il désigne une locale prise en charge, puis (2) l'en-tête
`Accept-Language` de la requête, puis (3) l'anglais. Définissez une langue
préférée avec `APP_LANGUAGE`, via la page Paramètres, ou avec le sélecteur de
langue de l'en-tête. Les locales prises en charge sont l'anglais (`en`),
l'espagnol (`es`), le chinois simplifié (`zh`), le japonais (`ja`), le
portugais brésilien (`pt-BR`) et le français (`fr`). Une valeur absente ou non prise en charge retombe
sur `Accept-Language`, puis sur l'anglais — jamais une erreur, jamais une clé
brute.

## Journalisation et journal d'activité

Chaque événement opérationnel est consigné de trois façons : reflété sur la
console du conteneur, inséré comme ligne dans le journal d'**Activité** intégré
(Paramètres → Activité) et ajouté à un fichier journal rotatif. Le fichier est
`posterpilot.log` dans `LOG_DIR` (par défaut `/data/logs` dans Docker) ; quand
il dépasse environ 5 Mo, il tourne (`posterpilot.log` → `.1` → `.2` …) en
conservant environ cinq fichiers. Comme l'emplacement par défaut se trouve sous
`/data`, le volume `/data` existant le persiste déjà — aucun montage
supplémentaire n'est requis.

La table du journal d'activité est plafonnée à `EVENT_RETENTION` lignes (`2000`
par défaut) ; les lignes plus anciennes sont purgées automatiquement. Vous
pouvez vider la table à tout moment avec le bouton **Effacer l'activité** de
l'onglet Activité (cela ne supprime pas le fichier journal sur disque).

## Référence des variables d'environnement

Chaque paramètre ci-dessous peut être fourni comme variable d'environnement. La
plupart sont aussi modifiables dans la page Paramètres ; définis via
l'environnement, ils prennent la priorité et sont verrouillés dans l'interface.

| Variable                  | Paramètre                        | Par défaut                             | Signification                                                                                     |
| ------------------------- | -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `SERVER_TYPE`             | Type de serveur                  | `plex`                                 | Serveur multimédia actif : `plex`, `jellyfin` ou `emby`.                                          |
| `PLEX_URL`                | URL Plex                         | —                                      | URL de base Plex, p. ex. `http://192.168.1.10:32400`.                                             |
| `PLEX_TOKEN`              | Jeton Plex (secret)              | —                                      | Votre `X-Plex-Token`.                                                                             |
| `PLEX_CLIENT_ID`          | Identifiant client Plex          | généré                                 | Identifiant stable par installation, envoyé à plex.tv pour la connexion par PIN / la découverte.  |
| `JELLYFIN_URL`            | URL Jellyfin                     | —                                      | URL de base Jellyfin (quand `SERVER_TYPE=jellyfin`).                                              |
| `JELLYFIN_API_KEY`        | Clé API Jellyfin (secret)        | —                                      | Clé API Jellyfin.                                                                                 |
| `EMBY_URL`                | URL Emby                         | —                                      | URL de base Emby (quand `SERVER_TYPE=emby`).                                                      |
| `EMBY_API_KEY`            | Clé API Emby (secret)            | —                                      | Clé API Emby.                                                                                     |
| `TMDB_KEY`                | Clé TMDB (secret)                | —                                      | Clé API TMDB v3 **ou** jeton bearer/JWT v4 (détection automatique).                               |
| `KOMETA_ASSETS_DIR`       | Répertoire des assets Kometa     | `./data/kometa` (`/kometa` dans Docker) | Répertoire où le YAML Kometa exporté est écrit.                                                   |
| `KOMETA_CONFIG_PATH`      | Chemin de config Kometa          | —                                      | Chemin du `config.yml` propre à Kometa à gérer. Vide/non défini = gestionnaire Kometa désactivé.  |
| `KOMETA_CONFIG_MODE`      | Mode de config Kometa            | `merge`                                | `merge` (chirurgical — préserve vos autres clés et commentaires) ou `own` (régénère tout le fichier). |
| `KOMETA_SERVER_INSTANCE_ID` | Liaison Plex de Kometa         | `legacy-default`                       | Instance Plex nommée exacte utilisée par chaque aperçu/écriture Kometa ; les liaisons non-Plex sont rejetées. |
| `DEFAULT_APPLY_METHOD`    | Méthode d'application par défaut | `both`                                 | Méthode d'application par défaut : `plex`, `kometa` ou `both`.                                    |
| `INCLUDED_SECTIONS`       | Sections incluses                | toutes films/séries                    | Clés des sections de médiathèque à synchroniser ; séparées par des virgules (env) ou tableau JSON (persisté). Vide = toutes. |
| `PROVIDER_MEDIUX`         | Fournisseur MediUX               | activé                                 | Active le fournisseur MediUX.                                                                     |
| `PROVIDER_TMDB`           | Fournisseur TMDB                 | activé                                 | Active le fournisseur de visuels TMDB.                                                            |
| `PROVIDER_FANART`         | Fournisseur Fanart.tv            | désactivé                              | Active le fournisseur Fanart.tv (requiert `FANART_KEY`).                                          |
| `PROVIDER_THEPOSTERDB`    | Fournisseur ThePosterDB          | désactivé                              | Active le fournisseur ThePosterDB.                                                                |
| `FANART_KEY`              | Clé Fanart.tv (secret)           | —                                      | Clé API Fanart.tv (le seul fournisseur à clé).                                                    |
| `MEDIUX_REQUEST_DELAY_MS` | Délai des requêtes MediUX        | `2000`                                 | Délai entre les requêtes MediUX, en millisecondes (limitation de débit).                          |
| `MEDIUX_CONCURRENCY`      | Concurrence MediUX               | `5`                                    | Nombre maximal de requêtes MediUX simultanées.                                                    |
| `HTTP_CACHE_TTL_DAYS`     | TTL du cache HTTP                | `7`                                    | Durée de réutilisation des réponses HTTP en cache (collectes), en jours.                          |
| `APPLY_CONCURRENCY`       | Concurrence d'application        | `4`                                    | Nombre d'éléments qu'une application en masse traite en parallèle.                                |
| `SUGGEST_PRESELECT`       | Visuels suggérés                 | activé                                 | Calcule et étiquette les candidats les mieux notés ; accepter/préparer reste explicite.           |
| `INCREMENTAL_SYNC`        | Synchronisation incrémentale     | activée                                | Ignore les éléments inchangés aux synchronisations suivantes (une réanalyse complète reste disponible). |
| `LIBRARY_DEFAULT_SORT`    | Tri par défaut de la médiathèque | `title`                                | Tri d'ouverture du mur de la médiathèque : `title`, `year`, `rating`, `runtime`, `recent` ou `added`. |
| `FUN_ENABLED`             | Section FUN                      | désactivée                             | Affiche le sélecteur, Poster Match, la galerie ambiante et le planificateur de session.           |
| `THUMB_CACHE_TTL_DAYS`    | TTL du cache de miniatures       | `30`                                   | Nombre de jours pendant lesquels une image d'aperçu en cache reste fraîche avant retéléchargement. |
| `THUMB_CACHE_MAX_MB`      | Taille du cache de miniatures    | `512`                                  | Taille maximale sur disque du cache de miniatures (Mo) avant éviction des entrées les moins récemment utilisées. |
| `AUTH_MODE`               | Sécurité → mode                  | `disabled`                             | Mode d'authentification : `disabled`, `local` ou `enabled`. Écrase l'interface et verrouille le contrôle. |
| `ADDRESS_HEADER`          | —                                | —                                      | En-tête portant la véritable IP du client derrière un proxy (p. ex. `x-forwarded-for`) pour le mode `local`. |
| `XFF_DEPTH`               | —                                | —                                      | Nombre de proxys de confiance devant l'application (adapter-node), associé à `ADDRESS_HEADER`.    |
| `MAX_UPLOAD_MB`           | —                                | `15`                                   | Taille maximale d'un téléversement d'affiche personnalisée, en Mo (rejeté avec `413` au-delà).    |
| `APP_LANGUAGE`            | Langue                           | — (auto)                               | Locale d'interface préférée : `en`, `es`, `zh`, `ja`, `pt-BR` ou `fr`.                                  |
| `LOG_DIR`                 | —                                | `/data/logs` (Docker)                  | Dossier du fichier journal rotatif `posterpilot.log` (~5 Mo × 5 fichiers).                        |
| `EVENT_RETENTION`         | —                                | `2000`                                 | Nombre maximal de lignes du journal d'activité conservées en base (les plus anciennes sont purgées). |
| `DATABASE_URL`            | —                                | `file:/data/posterpilot.db` (Docker)   | URL de fichier libsql pour la base de données SQLite.                                             |
| `PORT`                    | —                                | `3000`                                 | Port d'écoute.                                                                                    |
| `APP_SECRET`              | —                                | — (clé auto)                           | Dérive la clé de chiffrement au repos (scrypt) ; a priorité sur le `data/.app-key` généré.        |
| `APP_KEY_FILE`            | —                                | `./data/.app-key`                      | Chemin du fichier de clé de chiffrement d'instance généré automatiquement (utilisé quand `APP_SECRET` n'est pas définie). |

Les indicateurs booléens acceptent `1` / `true` / `on` / `yes` (sans distinction
de casse) pour _activé_ ; toute autre valeur (ou l'absence de valeur) laisse la
valeur par défaut documentée.

:::note
`DATABASE_URL`, `PORT`, `LOG_DIR`, `EVENT_RETENTION`, `APP_SECRET`,
`APP_KEY_FILE`, `ADDRESS_HEADER`, `XFF_DEPTH` et `MAX_UPLOAD_MB` sont des
paramètres de niveau déploiement — ils sont lus uniquement depuis l'environnement
et ne font pas partie de la page Paramètres intégrée.
:::
