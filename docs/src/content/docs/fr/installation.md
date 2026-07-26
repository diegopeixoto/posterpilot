---
title: Installation
description: Exécutez PosterPilot comme un unique conteneur Docker à partir de l'image officielle GHCR, avec des exemples Docker Compose pour macOS et Unraid.
---

PosterPilot s'exécute sous la forme d'un unique conteneur Docker. La même image
multi-architecture (`amd64` + `arm64`) fonctionne sur un Mac, un serveur Unraid
ou partout ailleurs où Docker tourne.

## L'image officielle

L'image officielle préconstruite est publiée sur le GitHub Container Registry :

```sh
docker pull ghcr.io/diegopeixoto/posterpilot:latest
```

Les tags suivent les versions publiées ; `:latest` pointe vers la version la plus
récente. Si vous préférez des mises à niveau reproductibles, vous pouvez plutôt
épingler un tag de version précis.

## Volumes et ports

Les volumes qui comptent :

- **`/data`** — l'état persistant de l'application : la base de données SQLite,
  les paramètres enregistrés, la clé de chiffrement des identifiants, les
  instantanés et révisions des visuels, les sauvegardes de l'application, le cache
  des miniatures et le fichier journal rotatif (`/data/logs/posterpilot.log`).
  Conservez-le sur un volume monté afin que l'état survive aux mises à jour du
  conteneur ; le fichier journal vit à l'intérieur de `/data`, aucun volume
  supplémentaire n'est donc nécessaire pour lui.
- **`/kometa`** — montez ici votre répertoire d'assets/config de Kometa afin que
  le YAML exporté atterrisse là où Kometa le lit. Nécessaire uniquement si vous
  utilisez l'export Kometa.
- **Le répertoire de configuration de Kometa** _(optionnel)_ — pour gérer le
  `config.yml` de Kometa lui-même avec le
  [gestionnaire Kometa](/posterpilot/fr/kometa-config-sync/), montez ce répertoire
  en **lecture/écriture** et faites pointer `KOMETA_CONFIG_PATH` vers le
  `config.yml` qu'il contient (par ex. `/config/config.yml`). PosterPilot écrit
  `posterpilot.yml` dans ce même répertoire ; ce seul montage suffit donc au
  gestionnaire. Voir
  [Monter la configuration de Kometa pour la synchronisation](#monter-la-configuration-de-kometa-pour-la-synchronisation).

Le conteneur écoute par défaut sur le port **3000** (configurable via la variable
d'environnement `PORT`). Publiez-le sur un port de l'hôte pour accéder à
l'interface.

## Clé de chiffrement pour les secrets stockés

PosterPilot chiffre les paramètres secrets (les jetons du serveur multimédia et
les clés API des fournisseurs) au repos. Par défaut, il génère automatiquement une
clé d'instance dans `data/.app-key` au premier démarrage — **aucune configuration
requise**. Comme cette clé vit à l'intérieur du volume `/data`, conserver `/data`
sur un stockage persistant et sauvegardé garantit que vos secrets restent
déchiffrables d'une mise à jour du conteneur à l'autre.

Vous pouvez aussi définir la variable d'environnement **`APP_SECRET`** pour
dériver la clé d'une valeur que vous contrôlez. Utilisez-la si vous voulez que vos
secrets restent portables lorsque le conteneur (et son `data/.app-key`) est
recréé. Si vous ne définissez pas `APP_SECRET`, considérez `data/.app-key` comme
faisant partie de vos sauvegardes — le perdre signifie ressaisir chaque
identifiant enregistré. Voir
[Configuration → Secrets et chiffrement](/posterpilot/fr/configuration/)
pour le comportement complet.

## Sauvegarder avant une mise à niveau

Avant de changer de version d'image, laissez les tâches de modification se
terminer et sauvegardez l'intégralité du volume `/data`. Si la version installée
comporte **Paramètres → Sauvegarde et restauration**, créez et validez également
une sauvegarde manuelle de l'application. Gardez le même `APP_SECRET`, ou une
copie de `.app-key`, à disposition après la mise à niveau.

Les mises à niveau exécutent des migrations additives de la base de données au
démarrage. Les installations existantes à serveur unique sont migrées en place
vers un **Serveur par défaut** nommé et protégé, sans perdre les éléments en cache
ni l'historique. Suivez la
[liste de contrôle de migration multi-serveur](/posterpilot/fr/multi-server-migration/)
pour la validation post-mise à niveau et les consignes de retour arrière.

## Monter la configuration de Kometa pour la synchronisation

Le [gestionnaire Kometa](/posterpilot/fr/kometa-config-sync/) permet à PosterPilot
de gérer le `config.yml` de Kometa lui-même. Pour l'utiliser, ce fichier doit être
accessible et modifiable depuis l'intérieur du conteneur PosterPilot :

1. **Montez le répertoire de configuration de Kometa en lecture/écriture.**
   Montez (bind mount) dans le conteneur le répertoire de l'hôte qui contient le
   `config.yml` de Kometa — par exemple sous `/config`. Les bind mounts sont en
   lecture/écriture par défaut ; ne le marquez pas `:ro`, car le gestionnaire
   écrit le fichier et laisse à côté une sauvegarde horodatée.
2. **Faites pointer `KOMETA_CONFIG_PATH` vers le fichier monté** — par ex.
   `/config/config.yml`. Le laisser vide garde le gestionnaire Kometa désactivé.

Ce seul répertoire suffit au gestionnaire : PosterPilot écrit `posterpilot.yml`
dans le **même répertoire que `config.yml`** (côte à côte) et le référence dans
`config.yml` par son simple nom de fichier ; il n'y a donc aucun chemin de
métadonnées ni montage séparé à configurer. Ce montage s'ajoute au volume `/data`
existant et au montage d'assets Kometa `/kometa`. Si votre installation Kometa
garde `config.yml` et le dossier d'assets dans le même répertoire, vous pouvez
monter ce seul répertoire et y faire pointer à la fois `KOMETA_ASSETS_DIR` et
`KOMETA_CONFIG_PATH`.

:::caution
Kometa lit le jeton Plex et la clé TMDB depuis `config.yml` en clair ; le
gestionnaire écrit donc ces secrets dans le fichier (et dans ses sauvegardes) sur
le volume monté. Gardez ce stockage digne de confiance et correctement protégé
par des permissions. Voir
[Gestionnaire Kometa](/posterpilot/fr/kometa-config-sync/) pour le comportement
complet.
:::

## Docker Compose (macOS)

Créez un fichier `docker-compose.yml` :

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    healthcheck:
      test:
        [
          'CMD',
          'bun',
          '-e',
          "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # Optional — you can also set these in the in-app Settings page instead:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
      # Optional — derive the secrets encryption key (else auto-generated at data/.app-key):
      # APP_SECRET: ${APP_SECRET:-}
      # Optional — manage Kometa's own config.yml (Kometa manager):
      # KOMETA_CONFIG_PATH: /config/config.yml
      # KOMETA_SERVER_INSTANCE_ID: legacy-default
    volumes:
      # Persistent app state (SQLite db + settings + history).
      - ./data:/data
      # Mount your Kometa assets/config dir here so exported YAML is picked up.
      - ./data/kometa:/kometa
      # Optional — Kometa's config dir (read/write) for the Kometa manager.
      # - ./data/kometa/config:/config
    restart: unless-stopped
```

Puis démarrez-le :

```sh
docker compose up -d
# UI at http://localhost:3000
```

Le `docker-compose.yml` fourni dans le dépôt a la même forme et inclut une option
`build: .` si vous préférez construire l'image localement plutôt que de la
télécharger :

```sh
docker compose up -d --build
```

## Unraid (Community Apps)

PosterPilot est référencé dans la boutique **Unraid Community Apps**. Ouvrez
l'onglet **Apps**, cherchez **PosterPilot** et cliquez sur _Install_.

Vous préférez l'ajouter à la main ? Le dépôt fournit aussi le modèle
`unraid/posterpilot.xml`. Dans l'interface d'Unraid, allez dans
**Docker → Add Container** et collez ceci dans le champ _Template_ :

```
https://raw.githubusercontent.com/diegopeixoto/posterpilot/main/unraid/posterpilot.xml
```

Il préremplit l'image GHCR, le port de l'interface web, les volumes `/data` et
`/kometa`, ainsi que des champs d'identifiants optionnels (Plex / Jellyfin / Emby,
TMDB, Fanart.tv, langue) — que vous pouvez tous configurer plus tard dans la page
des paramètres.

Pour utiliser aussi le [gestionnaire Kometa](/posterpilot/fr/kometa-config-sync/),
ajoutez un mappage de chemin pour le répertoire de configuration de Kometa
(lecture/écriture) et définissez `KOMETA_CONFIG_PATH` sur le `config.yml` monté —
le même montage supplémentaire que dans les exemples Compose ci-dessous.

## Docker Compose (Unraid)

Vous préférez Compose ? Faites pointer les volumes vers votre partage `appdata` —
en particulier, faites pointer le volume Kometa vers votre répertoire de
configuration Kometa **existant**, afin que le YAML exporté atterrisse là où
Kometa le lit déjà :

```yaml
services:
  posterpilot:
    image: ghcr.io/diegopeixoto/posterpilot:latest
    container_name: posterpilot
    ports:
      - '3000:3000'
    environment:
      PORT: '3000'
      DATABASE_URL: file:/data/posterpilot.db
      KOMETA_ASSETS_DIR: /kometa
      # Optional — or configure these in the Settings page:
      PLEX_URL: ${PLEX_URL:-}
      PLEX_TOKEN: ${PLEX_TOKEN:-}
      TMDB_KEY: ${TMDB_KEY:-}
      # Optional — derive the secrets encryption key (else auto-generated at data/.app-key):
      # APP_SECRET: ${APP_SECRET:-}
      # Optional — manage Kometa's own config.yml (Kometa manager):
      # KOMETA_CONFIG_PATH: /config/config.yml
      # KOMETA_SERVER_INSTANCE_ID: legacy-default
    volumes:
      - /mnt/user/appdata/posterpilot:/data
      - /mnt/user/appdata/kometa/config:/kometa
      # Optional — Kometa's config dir (read/write) for the Kometa manager.
      # - /mnt/user/appdata/kometa/config:/config
    restart: unless-stopped
```

Définissez `PLEX_URL` / `PLEX_TOKEN` / `TMDB_KEY` dans l'environnement du
conteneur, ou laissez-les vides et configurez tout via la page des paramètres,
puis ouvrez le conteneur sur le port 3000.

## Premier démarrage

1. Démarrez le conteneur et ouvrez `http://<host>:3000` (par ex.
   `http://localhost:3000`).
2. Au premier démarrage, rien n'est encore synchronisé. Une bannière vous oriente
   vers l'**assistant de configuration** accessible sur `/setup`, qui vous guide
   en six étapes : choisir une langue, connecter un serveur multimédia, ajouter
   une clé TMDB, activer les fournisseurs de visuels, choisir les médiathèques à
   synchroniser et lancer la première synchronisation. Pour Plex, l'assistant
   inclut une connexion par code PIN et une découverte des connexions, si bien que
   vous n'avez jamais à coller un jeton ou une URL. L'assistant peut être ignoré —
   vous pouvez tout configurer dans les **paramètres** à la place. Chaque étape
   n'avance qu'une fois validée par le serveur ; une erreur affichée en ligne vous
   maintient sur l'étape en cours. La dernière étape suit la première
   synchronisation jusqu'à un résultat définitif et propose le détail de l'échec
   ou une nouvelle tentative plutôt que d'annoncer prématurément la fin.
3. Si vous avez défini des identifiants via des variables d'environnement, ils
   apparaissent déjà configurés et verrouillés en édition, aussi bien dans
   l'assistant que dans les paramètres (voir
   [Configuration](/posterpilot/fr/configuration/)).
4. Une fois la synchronisation terminée, commencez à trouver et à appliquer des
   visuels (voir [Utilisation](/posterpilot/fr/usage/)).

![L'assistant de configuration de PosterPilot au premier démarrage, montrant l'étape de la langue et l'indicateur de progression en six étapes](/posterpilot/screenshots/setup-wizard.webp)

## Restaurer une sauvegarde de l'application

Utilisez **Paramètres → Sauvegarde et restauration** plutôt que de remplacer un
fichier SQLite en cours d'utilisation. L'aperçu de restauration valide les sommes
de contrôle, l'intégrité de la base de données, le schéma, l'espace disque, les
chemins et la compatibilité de la clé de chiffrement. La confirmation bloque les
nouvelles modifications, laisse se terminer le travail en cours, crée une
sauvegarde de sécurité protégée et prépare un marqueur de redémarrage. Redémarrez
le conteneur pour que le remplacement ait lieu avant l'ouverture de libsql ;
inspectez ensuite le rapport de disponibilité. Voir
[Automatisation et récupération](/posterpilot/fr/automation-recovery/).

## Vérification de l'état

L'application expose un point de terminaison non authentifié `GET /api/health`
qui renvoie `{ "status": "ok", "version": "x.y.z" }` avec un code HTTP 200 —
utilisez-le comme sonde de santé du conteneur (le `docker-compose.yml` fourni le
fait déjà) :

```sh
curl -s http://localhost:3000/api/health
```
