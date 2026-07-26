---
title: Automatisation, diagnostics, sauvegarde et récupération
description: Exploitez des tâches durables et des planifications en mode révision d'abord, diagnostiquez les échecs et sauvegardez ou restaurez PosterPilot en toute sécurité.
---

PosterPilot garde le travail de routine durable et centré sur la révision. La
synchronisation, la découverte, les nouvelles tentatives et les applications
confirmées s'exécutent comme des tâches persistées ; les planifications peuvent
alimenter le travail de révision, mais n'appliquent jamais de visuels
automatiquement.

## Tâches durables

Le tableau de bord affiche les tâches en file d'attente, en cours, planifiées pour
une nouvelle tentative et terminées, avec leur progression en direct. Recharger la
page ou naviguer n'annule pas le travail. Les tâches actives équivalentes sont
réutilisées, tandis que les mutations qui se chevauchent sont rejetées avec un lien
ou un identifiant vers la tâche en conflit.

Chaque tâche conserve sa portée de serveur et de médiathèque, ses entrées
immuables, ses tentatives, son résumé de résultat et ses échecs par cible expurgés.
Au redémarrage du processus, le travail en file d'attente sûr reprend. Une mutation
de visuels non idempotente interrompue en pleine écriture est laissée à la révision
plutôt que rejouée aveuglément.

Utilisez **Annuler** pour demander l'annulation. Le travail déjà validé reste
enregistré. En cas d'échec partiel, **Réessayer les échecs** crée un travail lié
uniquement pour les échecs réessayables. Les échecs permanents de validation,
d'identifiants ou de plan périmé exigent une correction et une nouvelle
prévisualisation.

## Automatisations en mode révision d'abord

Ouvrez **Paramètres → Automatisation** et créez une automatisation nommée pour le
serveur actif. Choisissez :

- une ou plusieurs médiathèques ;
- un intervalle, une heure locale quotidienne ou un déclencheur d'évènement
  (`new items` ou `sync completed`) ;
- un fuseau horaire IANA pour les occurrences planifiées ;
- **Synchroniser** ou **Synchroniser et découvrir** ;
- une vue de révision enregistrée facultative ;
- une fenêtre de rattrapage et un seuil de mise en pause après échecs consécutifs.

L'action par défaut est `sync_discover`. Chaque occurrence fige ses entrées et crée
ou réutilise une seule tâche durable. Modifier une planification affecte les
occurrences futures, pas le travail déjà en file d'attente. Si le service redémarre
pendant la fenêtre de rattrapage, une seule occurrence logique manquée est mise en
file d'attente ; les livraisons en double sont fusionnées.

:::important
Les automatisations se limitent à la révision. Elles synchronisent et découvrent
éventuellement des candidats, puis laissent les décisions dans la révision. Elles
ne créent pas de tâches d'application.
:::

### Déclencheur webhook

Pour une automatisation, générez un identifiant webhook dans les paramètres.
PosterPilot affiche le point de terminaison et le jeton une seule fois. Envoyez le
jeton dans l'en-tête `X-PosterPilot-Webhook-Token`. La rotation invalide le jeton
précédent ; la désactivation le supprime. Traitez le jeton comme un secret et ne le
placez ni dans une URL ni dans un journal.

![Paramètres d'automatisation de PosterPilot avec deux planifications limitées à la révision et l'historique des occurrences des exécutions passées](/posterpilot/screenshots/settings-automation.webp)

## Diagnostiquer avant de réessayer

Ouvrez **Paramètres → Diagnostics** pour lancer des vérifications indépendantes et
sans mutation pour chaque serveur nommé, TMDB, les fournisseurs de visuels, les
chemins Kometa, le répertoire de données et le stockage des sauvegardes. Les
résultats distinguent les services indisponibles, les identifiants manquants ou
rejetés, les délais d'attente dépassés et les problèmes de chemins en
lecture/écriture ; les vérifications de capacités du serveur montrent quelles
opérations sur les visuels sont prises en charge.

Le dernier résultat et le dernier succès survivent au redémarrage. Une panne de
fournisseur peut laisser les derniers candidats connus valides marqués comme
périmés ; une réponse vide réussie ultérieure efface les anciens candidats de ce
fournisseur.

Vous pouvez exporter explicitement une archive de support expurgée. Les titres sont
omis sauf si vous y consentez. Si une entrée facultative ne peut pas être prouvée
sûre, elle est omise et signalée dans le manifeste.

## Sauvegardes de l'application

Ouvrez **Paramètres → Sauvegarde et restauration** et sélectionnez **Créer une
sauvegarde**. PosterPilot réalise un instantané SQLite cohérent et stocke une
archive gérée par l'application dans le répertoire de données. Le manifeste inclut
les sommes de contrôle, les versions du schéma et de l'application, le mode de clé
et les références de chemins externes. Il ne copie ni votre serveur multimédia ni
le contenu Kometa monté en externe.

Les sauvegardes utilisant la `.app-key` générée incluent cette clé. En mode
`APP_SECRET`, le secret n'est jamais inclus ; la restauration exige le même
`APP_SECRET` effectif.

Vous pouvez valider, exporter ou supprimer une archive. L'export exige la
reconnaissance d'un avertissement distinct, car une archive peut contenir des
identifiants et du matériel de clé. La rétention par nombre maximal et/ou par
ancienneté ne s'applique qu'aux archives valides non protégées ; les sauvegardes
manuelles et les sauvegardes de sécurité créées avant restauration sont protégées
par défaut.

![Paramètres de sauvegarde et de restauration de PosterPilot avec les limites de rétention et une sauvegarde vérifiée et protégée proposant la vérification, l'export et la prévisualisation de restauration](/posterpilot/screenshots/settings-backup.webp)

## Flux de restauration

1. Sélectionnez **Prévisualiser la restauration** pour une archive validée.
2. Examinez la somme de contrôle, l'intégrité SQLite, la compatibilité du schéma,
   les migrations requises, l'espace disque, la compatibilité de la clé et les
   avertissements de chemins externes.
3. Reconnaissez la portée du remplacement et confirmez le plan inchangé.
4. PosterPilot entre en mode maintenance, bloque les nouvelles mutations, laisse se
   terminer les tâches de mutation actives, crée une sauvegarde de sécurité
   protégée et prépare un marqueur de redémarrage.
5. Redémarrez le conteneur. Le remplacement de la base de données et de la clé a
   lieu avant l'ouverture de libsql.
6. Examinez le rapport de disponibilité. Si le remplacement ou la migration échoue,
   PosterPilot revient à la sauvegarde de sécurité.

L'indisponibilité d'un serveur ou d'un fournisseur externe n'est qu'un
avertissement lorsque l'intégrité locale est saine ; une incompatibilité de somme
de contrôle, de base de données, de schéma plus récent, de chemin ou de clé est
bloquante.

:::caution
Ne remplacez pas manuellement le fichier SQLite en service. Utilisez le flux de
restauration prévisualisé et conservez la sauvegarde de sécurité créée avant la
restauration jusqu'à ce que les médiathèques, les identifiants, les chemins Kometa,
les planifications et les portées de serveur aient été vérifiés.
:::

Consultez [Sécurité, vérification et annulation](../safety/) pour les garanties sur
les mutations et [Migration multi-serveurs](../multi-server-migration/) pour les
vérifications de mise à niveau.
