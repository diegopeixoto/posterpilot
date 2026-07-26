---
title: Sécurité, vérification et annulation
description: Comprenez le contrat de prévisualisation exact de PosterPilot, les révisions immuables des visuels, la vérification, les échecs partiels et les limites sûres de l'annulation.
---

PosterPilot traite chaque écriture de visuels ou de configuration comme une
opération soumise à révision. Les suggestions, les résultats FUN, les familles de
collections, les planifications et les tâches de découverte n'écrivent jamais de
visuels d'eux-mêmes.

## Le contrat d'écriture

Pour les visuels écrits directement sur le serveur multimédia, les métadonnées
Kometa, les téléversements personnalisés, les opérations sur les collections et les
modifications du `config.yml` de Kometa, le chemin sûr est le suivant :

1. **Préparez** le visuel ou l'entrée de configuration.
2. **Prévisualisez** les cibles exactes, les destinations, les emplacements, les
   écritures et les éléments ignorés.
3. **Confirmez** le plan émis par le serveur. Le plan est de courte durée, à usage
   unique et lié au contenu prévisualisé ainsi qu'aux empreintes des sources.
4. **Exécutez** uniquement les opérations figées. L'exécution ne relance pas la
   découverte et ne remplace jamais silencieusement un candidat.
5. **Vérifiez** chaque destination après l'écriture.
6. **Enregistrez** une révision propre à chaque destination et à chaque
   emplacement, échecs compris.

Si la sélection, le visuel cible, la composition de la collection, le fichier
Kometa, la destination ou toute autre entrée liée change après la prévisualisation,
la confirmation est rejetée. Demandez une nouvelle prévisualisation ; ne réutilisez
pas un ancien jeton de confirmation.

Pour un élément unique dont le plan prévisualisé ne comporte aucun avertissement —
rien d'ignoré et au moins une écriture — PosterPilot émet lui-même la confirmation
dans le même clic, si bien que les étapes 2 et 3 se déroulent sans boîte de dialogue
séparée. Toute cible ignorée, un plan vide, « appliquer et suivant » et les
opérations sur les collections conservent l'étape de confirmation explicite. Le
contrat côté serveur est identique dans les deux cas : le plan reste prévisualisé,
de courte durée, à usage unique et exécuté figé.

![Fiche d'un élément dans PosterPilot avec la confirmation d'application montrant le plan exact figé — affichée dès qu'un plan doit être révisé avant toute écriture](/posterpilot/screenshots/apply-exact-plan.webp)

## Ce qui est capturé

Avant une mutation planifiée, PosterPilot enregistre l'état antérieur de
l'emplacement concerné. Lorsque le fournisseur du serveur multimédia permet de lire
les octets de l'image, il stocke un instantané local, adressé par contenu, dans le
répertoire de données de l'application. Les révisions Kometa conservent la valeur
YAML gérée précédente, y compris le fait qu'elle était absente.

La chronologie fonctionne uniquement par ajout. Appliquer de nouveau ou annuler
n'efface pas la tentative d'origine. Un fichier téléversé est représenté par une
identité de contenu sûre ; les identifiants et les URL contenant des secrets ne sont
pas exposés dans l'historique du navigateur.

:::caution
Un emplacement dont l'image d'origine n'a pas pu être lue est enregistré comme
indisponible. PosterPilot ne prétend pas qu'un tel emplacement puisse être restauré
à l'identique. Examinez la prévisualisation de l'annulation avant de la confirmer.
:::

## États de vérification

- **Exacte** — la destination peut être comparée avec le contenu attendu ou la
  valeur YAML gérée exacte.
- **Au mieux** — le fournisseur expose une identité stable de l'image modifiée,
  mais pas de preuve octet par octet.
- **Échec ou indisponible** — l'écriture a échoué, la destination diffère, ou le
  fournisseur n'a pas pu apporter suffisamment de preuves. Cet état n'est jamais
  présenté comme un succès vérifié.

Les résultats côté serveur et côté Kometa restent indépendants. Une opération
« Les deux » peut donc réussir partiellement, et l'échec d'une saison ou d'un
épisode ne masque pas les emplacements voisins qui ont réussi.

## Échecs partiels et nouvelles tentatives

Ouvrez le détail de la tâche pour voir les décomptes de réussites, d'échecs,
d'éléments ignorés et d'interruptions, ainsi que la destination et l'emplacement
concernés. **Réessayer les échecs** crée un travail lié uniquement pour les unités
en échec éligibles ; les mutations réussies ne sont pas répétées. Les échecs de
validation ou de configuration manquante peuvent exiger de corriger les paramètres
et de générer une nouvelle prévisualisation plutôt que de réessayer.

« Appliquer et suivant » n'avance que lorsque chaque cible sélectionnée s'est
terminée et a passé la vérification. Sinon, il reste sur l'élément avec le détail
enregistré.

## Annuler depuis la chronologie des visuels

Sur la fiche d'un élément, utilisez la chronologie des visuels pour prévisualiser
l'annulation d'une révision disponible, d'une saison ou de l'élément entier. La
prévisualisation liste les opérations restaurables ainsi que les emplacements
indisponibles ou déjà restaurés. La confirmation restaure l'instantané ou la valeur
antérieurs, vérifie le résultat lorsque c'est pris en charge et ajoute une nouvelle
révision d'annulation.

La confirmation remet le plan figé à la file de tâches durable : une annulation
volumineuse — toute une collection, par exemple — rapporte sa progression et
reprend après un redémarrage au lieu de disparaître avec la requête qui l'a lancée.

L'annulation est délimitée : restaurer une saison ne modifie ni l'affiche de la
série ni une autre saison ; restaurer des métadonnées gérées par Kometa ne réécrit
pas du YAML sans rapport. Les résultats mixtes restent visibles et peuvent être
retentés indépendamment.

![Chronologie de l'historique des visuels dans PosterPilot montrant une révision appliquée et vérifiée, avec une entrée par destination et par emplacement, chacune dotée de sa propre action d'annulation](/posterpilot/screenshots/item-artwork-history.webp)

## Sécurité de la configuration Kometa

La synchronisation structurée, l'enregistrement du YAML brut et la restauration
d'une sauvegarde possèdent chacun leur propre prévisualisation et leur propre
confirmation. Les diffs affichés dans le navigateur masquent les secrets gérés.
Une écriture confirmée passe par un chemin atomique de sauvegarde puis
remplacement ; les plans périmés, expirés, modifiés ou réutilisés n'écrivent rien.
Consultez le [gestionnaire Kometa](../kometa-config-sync/) pour l'organisation des
fichiers et l'avertissement sur les secrets en clair.

## Bonnes pratiques d'exploitation

- Gardez `/data` persistant et incluez `.app-key` dans vos sauvegardes lorsque
  `APP_SECRET` n'est pas défini.
- Inspectez les éléments ignorés avant de confirmer ; un élément ignoré n'est pas
  un succès vérifié.
- Utilisez les diagnostics avant de multiplier les tentatives lorsqu'un serveur, un
  fournisseur ou un chemin est en mauvaise santé.
- Créez une sauvegarde de l'application avant une mise à niveau, une purge de
  serveur ou une opération de restauration.
- Conservez la découverte automatique en mode révision d'abord. Aucune
  planification intégrée n'applique automatiquement les visuels.

Poursuivez avec le [flux de travail quotidien](../usage/) ou le
[guide d'automatisation et de récupération](../automation-recovery/).
