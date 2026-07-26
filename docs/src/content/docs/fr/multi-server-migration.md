---
title: Administration multi-serveurs et migration
description: Mettez à niveau une installation mono-serveur en toute sécurité, gérez des instances Plex/Jellyfin/Emby nommées et comprenez les contrats de portée stricte et d'application inter-serveurs.
---

PosterPilot peut gérer plusieurs instances Plex, Jellyfin et Emby nommées tout en
gardant les médiathèques, les éléments, les tâches, les révisions, les collections,
l'état de révision et les planifications strictement séparés.

## Avant de mettre à niveau une installation existante

1. Arrêtez les mutations de visuels et laissez les tâches actives se terminer.
2. Sauvegardez le volume `/data` complet, y compris `posterpilot.db`, les fichiers
   WAL s'ils existent, les instantanés de visuels, les sauvegardes et `.app-key`.
   Si votre version actuelle propose la gestion des sauvegardes de l'application,
   créez et validez également une sauvegarde manuelle.
3. Notez le type du serveur actuel, son URL et si son identifiant provient de
   l'environnement ou des paramètres. Gardez le même `APP_SECRET` ou la même
   `.app-key` à disposition.
4. Récupérez la nouvelle image et redémarrez normalement. Ne créez pas de base de
   données vierge et n'exécutez pas de migrations SQL manuelles.

## Ce que fait la migration

La migration de la base de données crée une instance nommée protégée,
**Default server** (le serveur par défaut), et affecte les lignes existantes
appartenant au serveur à sa portée stable `legacy-default`. Au démarrage, la
connexion héritée effective (les valeurs d'environnement gardent la priorité) est
matérialisée dans cette instance et sélectionnée comme active.

La migration est transactionnelle et idempotente. Les identifiants d'éléments
existants, les candidats, les sélections, les éléments ignorés, les tâches, les
révisions, l'historique et les médiathèques en cache restent en place ; une
resynchronisation destructive n'est pas nécessaire. Une installation neuve non
configurée ne crée aucune connexion factice et poursuit vers l'assistant de
configuration.

:::note
Les variables d'environnement héritées (`SERVER_TYPE`, `PLEX_*`, `JELLYFIN_*`,
`EMBY_*`) décrivent la connexion par défaut protégée. Les instances nommées
supplémentaires se créent dans les paramètres et sont stockées avec leurs propres
identifiants chiffrés ; les variables d'environnement ne définissent pas une liste
arbitraire de serveurs.
:::

## Vérifications après mise à niveau

Après le démarrage :

1. Ouvrez **Paramètres → Serveurs** et confirmez que **Default server** présente le
   type, l'URL, l'indicateur d'identifiant défini et le badge actif attendus.
2. Lancez son test de connexion, puis **Paramètres → Diagnostics**.
3. Ouvrez la médiathèque, la révision, les collections, le tableau de bord et ses
   tâches, ainsi que la chronologie d'un élément. Les décomptes et l'historique
   doivent correspondre à l'installation d'avant la mise à niveau.
4. Confirmez les médiathèques sélectionnées et la liaison Plex de Kometa.
5. Lancez une synchronisation incrémentale. N'utilisez la réanalyse complète que
   lorsque vous voulez délibérément relire chaque élément source ; elle préserve
   l'historique des révisions.

Si la migration ou le déchiffrement ne peut pas aboutir, arrêtez le nouveau
conteneur et restaurez le volume de données d'avant la mise à niveau, ou utilisez
le flux de restauration validé de l'application. Ne continuez pas à fonctionner sur
une base de données partiellement copiée.

## Ajouter et changer de serveur

Dans **Paramètres → Serveurs**, choisissez **Ajouter un serveur**, saisissez un nom
unique, le type de fournisseur, l'URL de base et un identifiant réutilisable adapté
au fournisseur, puis testez avant d'ajouter. Plex utilise un jeton ; Jellyfin et
Emby utilisent une clé API ou un jeton d'accès. Les secrets stockés ne sont jamais
renvoyés au navigateur.

Dès qu'au moins deux instances activées existent, utilisez le sélecteur de
l'interface ou **Rendre actif**. Les pages liées au serveur se rechargent pour
cette instance. Les filtres de médiathèque et les vues de révision enregistrées
appartiennent à leur serveur et ne sont pas réutilisés silencieusement dans une
portée invalide.

Les tâches et les planifications conservent leur serveur nommé. Des tâches
indépendantes sur des serveurs différents peuvent s'exécuter en parallèle ; le
travail qui se chevauche sur un même serveur est dédupliqué ou bloqué. Les
capacités sont propres à chaque instance : un emplacement disponible sur Plex peut
être indisponible sur une version de Jellyfin ou d'Emby.

![Paramètres de serveur multimédia de PosterPilot listant deux serveurs connectés, le Plex par défaut actif et un Jellyfin en bonne santé, avec les actions de test, de désactivation et de déconnexion](/posterpilot/screenshots/settings-servers.webp)

## Liaison Kometa

Kometa est propre à Plex. Définissez `KOMETA_SERVER_INSTANCE_ID` ou choisissez la
liaison Plex nommée dans les paramètres. La prévisualisation et la confirmation
valident cette liaison. Sélectionner une instance Jellyfin ou Emby, ou emprunter
silencieusement l'identifiant d'une autre instance Plex, est rejeté.

## Application de visuels entre serveurs

L'application entre serveurs est toujours explicite. Une destination n'est éligible
que par un identifiant TMDB, IMDb ou TVDB exact et partagé ; la similarité des
titres ne suffit jamais. La prévisualisation liste chaque serveur et élément de
destination, la décision de capacité, l'emplacement, l'état actuel, la sélection et
les éléments ignorés. La confirmation est liée au plan complet, et chaque serveur
reçoit des révisions et des résultats de vérification indépendants.

L'action Appliquer normale, limitée à un seul serveur, ne se propage jamais à un
autre serveur. Là où l'interface actuelle n'expose pas la sélection
inter-serveurs, l'API exacte de prévisualisation/confirmation est destinée à des
intégrations contrôlées ; ne l'émulez pas en changeant de serveur actif entre la
prévisualisation et la confirmation.

## Désactiver, déconnecter ou purger

- **Désactiver** bloque les nouvelles mutations manuelles et automatiques, mais
  conserve les identifiants, les données en cache et l'historique.
- **Déconnecter** supprime l'identifiant stocké, désactive les planifications et
  conserve les enregistrements de la portée à titre d'historique. Une confirmation
  est requise.
- La **purge définitive** n'est disponible qu'après la déconnexion. Elle affiche
  d'abord les décomptes d'impact exacts et des conseils de sauvegarde, puis exige
  une confirmation distincte du plan inchangé. Les tâches de mutation actives la
  bloquent. Les autres serveurs ne sont pas affectés.

L'instance par défaut protégée issue de la migration porte l'étiquette **Legacy**
(héritée) et ne peut être ni modifiée ni purgée par le flux destructif ordinaire.
Cela empêche une mise à niveau de supprimer silencieusement la portée d'origine.

Avant toute purge, créez une sauvegarde et inspectez l'impact sur les éléments, les
tâches, les révisions, les collections, les planifications et les fichiers
d'instantanés. Consultez [Automatisation et récupération](../automation-recovery/)
pour la sauvegarde et la restauration, et [Configuration](../configuration/) pour
la priorité des variables d'environnement.
