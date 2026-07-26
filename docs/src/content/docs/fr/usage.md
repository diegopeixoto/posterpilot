---
title: Utilisation
description: Lancez l'assistant de configuration, synchronisez une médiathèque, trouvez des visuels chez plusieurs fournisseurs, appliquez-les via l'API du serveur multimédia ou l'export Kometa, composez des sets personnalisés, filtrez et triez la médiathèque, et consultez le journal d'activité.
---

Cette page décrit le flux de travail quotidien une fois PosterPilot
[installé](/posterpilot/fr/installation/) et
[configuré](/posterpilot/fr/configuration/).

## Assistant de première installation

Sur une installation neuve, une bannière vous oriente vers l'assistant, accessible
à l'adresse `/setup`. Il vous guide à travers six étapes dans l'ordre, en
enregistrant chacune au fur et à mesure :

1. **Langue** — choisissez la langue de l'interface.
2. **Serveur multimédia** — choisissez Plex, Jellyfin ou Emby. Avec Plex, vous
   pouvez vous connecter par code PIN (PosterPilot affiche un code et un lien
   d'autorisation, puis conserve pour vous le jeton obtenu) et sélectionner une
   connexion locale/distante découverte. Jellyfin et Emby demandent une URL de
   serveur et vous permettent de **vous connecter avec votre nom d'utilisateur et
   votre mot de passe** — PosterPilot les échange contre un jeton d'accès, si bien
   que vous n'avez jamais à chercher une clé API (le mot de passe ne sert qu'à
   cette unique requête et n'est jamais stocké ; coller une clé à la main reste
   possible en solution de repli). Un bouton **Tester** vérifie la connexion.
3. **TMDB** — collez une clé API TMDB (un lien vers les paramètres API de TMDB
   est fourni).
4. **Fournisseurs** — activez ou désactivez les fournisseurs de visuels (MediUX,
   TMDB, Fanart.tv, ThePosterDB) et saisissez une clé Fanart.tv si vous
   l'utilisez.
5. **Médiathèques** — une fois la connexion établie, l'assistant liste vos
   médiathèques de films et de séries ; cochez celles à synchroniser (toutes sont
   sélectionnées par défaut, ce qui inclut aussi les médiathèques que vous
   ajouterez plus tard).
6. **Première synchronisation** — lancez la synchronisation initiale et suivez son
   statut en direct jusqu'à un résultat terminal. Le détail d'un échec et l'action
   de nouvelle tentative restent visibles ; l'assistant ne se déclare pas terminé
   simplement parce que la tâche a été acceptée.

L'assistant peut être **ignoré** à tout moment (le lien _Passer_ mène directement
au tableau de bord) — tout ce qu'il couvre est également disponible dans les
**Paramètres**.

## Synchroniser une médiathèque

Une synchronisation importe vos médiathèques de films et de séries depuis le
serveur multimédia nommé actif dans le cache local de PosterPilot, et résout
chaque titre vers un identifiant TMDB afin que les fournisseurs de visuels
puissent être interrogés.

1. Assurez-vous que les identifiants du type de serveur actif et une clé TMDB
   sont configurés. Une synchronisation est bloquée (avec un message clair
   indiquant ce qui manque) si ce n'est pas le cas.
2. Vous pouvez éventuellement restreindre les sections synchronisées via la liste
   **Médiathèques à synchroniser** (dans l'assistant ou dans Paramètres → Serveur
   multimédia) ou avec `INCLUDED_SECTIONS` — laissez-la vide pour synchroniser
   toutes les sections de films et de séries, y compris celles que vous ajouterez
   plus tard.
3. Lancez la synchronisation depuis le **tableau de bord** (le bouton
   **Synchroniser**). Elle s'exécute en tâche de fond avec une progression en
   direct affichée sur place ; les cartes de statistiques (éléments, films,
   séries, résolus, avec visuels, avec MediUX, appliqués) grimpent au fil de
   l'exécution.

Chaque élément revient avec son titre, son année, son type, ses GUID externes
(tmdb/imdb/tvdb lorsqu'ils existent) et son affiche actuelle. Un élément sans
GUID externe reste listé, mais il est marqué comme non résoluble pour la
recherche chez les fournisseurs au lieu d'être écarté.

Les synchronisations suivantes sont **incrémentales** par défaut : PosterPilot
compare chaque élément à l'horodatage de dernière modification du serveur
multimédia et ne re-résout et n'enrichit à nouveau que ceux qui ont changé depuis
la synchronisation précédente ; une réanalyse de routine est donc bien plus
rapide que la première. Une **réanalyse complète**, qui retraite tout, reste
disponible, et vous pouvez désactiver entièrement la synchronisation incrémentale
(voir
[Configuration → Performances et réglages](/posterpilot/fr/configuration/)).

## Travailler depuis la boîte de révision

La **révision** est le flux titre par titre le plus rapide. Elle déduit des états
actionnables pour les éléments nouveaux, non résolus, sans candidat, avec
suggestion prête, préparés, en échec partiel, modifiés en externe, ignorés et
terminés. Filtrez par serveur/médiathèque/type/état/fournisseur, recherchez,
choisissez un tri déterministe, ou enregistrez le filtre courant comme vue
nommée.

Ouvrir un élément préserve le contexte de la révision et propose une navigation
précédent, suivant et retour. Comparez les visuels actuels, suggérés et préparés
pour chaque emplacement. Accepter une suggestion est un geste explicite — rien
n'est préparé au chargement de la page. Les actions clavier sont listées sur la
page et ne se déclenchent pas lorsque le focus se trouve dans un champ de
formulaire ou une fenêtre modale.

**Appliquer et suivant** crée d'abord l'aperçu exact habituel, demande
confirmation, attend la tâche et la vérification post-écriture, et n'avance
qu'une fois que chaque destination sélectionnée a réussi. Une omission, un échec
partiel ou un échec de vérification vous maintient sur l'élément, avec le détail
de la tâche et l'action de nouvelle tentative.

## Corriger une correspondance TMDB

Un élément non résolu ou mal apparié peut faire l'objet d'une recherche manuelle
par titre, année et type film/série. Les résultats incluent l'identité TMDB et
des métadonnées de désambiguïsation. Confirmer épingle cette identité, invalide
les candidats issus de l'ancienne identité et enregistre un événement d'audit.
Remplacer ou effacer un épinglage manuel est tout aussi explicite ; l'effacement
rend l'élément de nouveau éligible à la résolution automatique par GUID.

Les pannes de fournisseurs sont isolées. Lors d'une indisponibilité passagère,
les derniers candidats connus de ce fournisseur peuvent être conservés,
visiblement marqués comme périmés. Un résultat vide obtenu avec succès plus tard
les efface, au lieu de traiter « aucun candidat » comme une panne.

## Le mur de la médiathèque

La médiathèque synchronisée s'affiche sous forme de grille d'affiches dotée d'une
barre d'outils de style Notion. Vous pouvez :

- **Rechercher** par titre.
- **Filtrer** depuis le menu contextuel **Filtre** : type de média (film /
  série), note minimale, genre, affiche manquante, disponibilité de visuels tous
  fournisseurs confondus, disponibilité MediUX réelle, état de changement
  (inchangé / encore sur l'affiche par défaut) et état ignoré. Le bouton Filtre
  affiche un badge avec le nombre de facettes actives.
- **Trier** depuis le menu contextuel **Tri** par titre, année de sortie, note,
  durée, changement le plus récent ou date d'ajout au serveur multimédia, avec un
  basculement croissant/décroissant indépendant. Le mur s'ouvre avec le tri
  configuré dans **Paramètres → Kometa & avancé** (par défaut : titre) ; un choix
  explicite dans la barre d'outils l'emporte toujours.
- Chaque filtre actif et le tri apparaissent sous forme de **puces amovibles**
  sous la barre d'outils — cliquez sur le ✕ d'une puce pour retirer ce seul
  critère, ou sur **Tout effacer** pour tout réinitialiser.
- Basculer l'**application automatique** (le bouton ⚡) pour les **contrôles de
  filtre uniquement** : activée, chaque changement de filtre déclenche
  immédiatement la navigation ; désactivée, les changements de filtre attendent
  le bouton Appliquer de la barre d'outils. Elle n'applique jamais de visuels. Le
  choix est mémorisé.
- **Ignorer** un élément que vous voulez laisser intact — les éléments ignorés
  sont exclus de la découverte, de l'application et de la sélection automatique,
  sont signalés visuellement sur le mur, et peuvent être inclus ou exclus depuis
  le menu Filtre. Désactivez ce marquage à tout moment pour réintégrer l'élément
  dans le flux de travail.
- Voir une **bannière en vedette** — un arrière-plan pour un élément récemment
  modifié, affiché au-dessus du mur dès qu'au moins un visuel a été appliqué.

Chaque vignette affiche la note de l'élément et un badge de statut dès qu'un
fournisseur dispose de visuels ; le filtre MediUX distinct signifie précisément
que MediUX a renvoyé un candidat. Le badge de changement reste distinct,
et le titre et l'année se révèlent au survol.

![Mur de la médiathèque PosterPilot avec recherche, filtre, tri, contrôles de statut et une grille d'affiches de films](/posterpilot/screenshots/library.webp)

## Trouver des visuels

Ouvrez un élément pour afficher sa vue détaillée : un bandeau d'arrière-plan avec
le logo de l'élément (ou son titre lorsqu'aucun logo n'existe), la note, l'année,
la durée (ou le nombre de saisons/épisodes pour les séries), les genres et le
synopsis, ainsi que les têtes d'affiche.

![Vue détaillée d'un élément PosterPilot avec métadonnées sur arrière-plan, distribution, nombre de visuels découverts, affiche et arrière-plan préparés, et bouton Appliquer](/posterpilot/screenshots/item-detail.webp)

- Si les visuels n'ont pas encore été découverts, utilisez **Trouver des
  visuels** pour lancer la découverte pour cet élément.
- La découverte interroge en parallèle tous les fournisseurs activés et stocke
  l'union de leurs candidats, chacun étiqueté avec son fournisseur.
- Les candidats sont regroupés **d'abord par fournisseur, puis par set**. Chaque
  set affiche l'attribution de son auteur, avec l'affiche et l'arrière-plan
  présentés ensemble. Pour les séries, la vue présente aussi les sets d'affiches
  de saisons et les sets de cartes-titres.
- Les sections de fournisseurs, les cartes de sets individuelles et (pour les
  séries) les groupes de saisons sont **repliables**. Au premier chargement, le
  premier fournisseur et son premier set sont dépliés — tout comme le groupe
  ThePosterDB lorsqu'il a des résultats, puisqu'il arrive sous la forme d'un set
  unique aplati — tandis que tout le reste est replié ; vos choix de
  pliage/dépliage persistent dans le navigateur d'un rechargement à l'autre et
  lorsque vous passez d'un élément à l'autre.
- L'en-tête de chaque groupe de fournisseur porte sa propre commande de
  **relance ⟳** (« Relancer la recherche MediUX », « Relancer la recherche
  ThePosterDB », …). Elle relance la découverte pour ce seul fournisseur et
  contourne le cache HTTP des collectes, si bien que vous obtenez des résultats
  réellement frais au lieu de la copie mise en cache pendant
  `HTTP_CACHE_TTL_DAYS`. La nouvelle exécution remplace les candidats stockés de
  ce fournisseur ; ceux de tous les autres fournisseurs restent intacts.
- Lorsque les **visuels suggérés** sont activés, le candidat le mieux noté pour
  chaque emplacement est clairement signalé en vue d'une action explicite de
  préparation/acceptation ; il n'est pas enregistré en silence. Les candidats
  sont notés selon la qualité du fournisseur, la résolution et l'adéquation du
  ratio ; ajustez les pondérations — ou désactivez la présélection — dans les
  Paramètres (voir
  [Configuration → Performances et réglages](/posterpilot/fr/configuration/)).

Vous pouvez préparer un set entier (« utiliser ce set »), ou prendre une affiche
dans un set et un arrière-plan dans un autre — les deux emplacements sont
indépendants.

![Vue détaillée d'un élément PosterPilot avec métadonnées sur arrière-plan, distribution, nombre de visuels découverts, affiche et arrière-plan préparés, et bouton Appliquer](/posterpilot/screenshots/item-detail.webp)

## Visuels de saisons et d'épisodes

Pour une série, les visuels sont préparés par emplacement : le visuel de la
série, l'affiche de chaque saison et la carte-titre de chaque épisode sont donc
indépendants les uns des autres :

- Les visuels d'un set sont organisés en un **groupe série** (affiche et
  arrière-plan) et un **groupe par saison**. Chaque groupe de saison contient
  l'affiche de cette saison et les cartes-titres de ses épisodes. (Un emplacement
  d'arrière-plan de saison existe dans le modèle mais n'est pas affiché, car
  aucun fournisseur ne propose actuellement d'arrière-plans de saison.)
- Sélectionner un candidat dans un emplacement de saison ou d'épisode prépare
  uniquement cet emplacement, sans toucher au niveau série ni à aucun autre
  emplacement. Resélectionner le candidat déjà préparé dans un emplacement
  l'efface à nouveau.
- **Utiliser ce set** remplit d'un coup chaque emplacement couvert par le set —
  série, chaque saison et chaque épisode — apparié par numéro de saison et
  d'épisode. Vous pouvez ensuite remplacer n'importe quel emplacement individuel
  tout en gardant le reste du set préparé.

Le compositeur épinglé récapitule tout ce qui est actuellement préparé —
l'affiche et l'arrière-plan de la série ainsi que le nombre de saisons et
d'épisodes préparés — et un unique **Appliquer** écrit le tout en une seule
action (voir [Appliquer un visuel](#appliquer-un-visuel)).

## Appliquer un visuel

Appliquez une sélection préparée avec la méthode de votre choix, sélectionnable à
chaque application, avec une valeur par défaut configurable
(`DEFAULT_APPLY_METHOD`, par défaut `both`). Chaque méthode crée d'abord un
aperçu exact. Passez en revue ses opérations serveur/Kometa et ses omissions,
puis utilisez l'action de confirmation distincte. Le plan à usage unique et à
durée limitée est lié à la sélection, à la destination, aux visuels actuels et à
l'état de la source :

- **Serveur multimédia (direct).** Capture l'état antérieur de l'emplacement,
  téléverse via le fournisseur nommé actif, verrouille lorsque c'est pris en
  charge, relit le résultat et enregistre une vérification exacte ou au mieux
  selon les capacités de cette instance.
- **Export Kometa.** Écrit un YAML compatible Kometa/PMM — `url_poster` (et
  `url_background` lorsqu'un arrière-plan est préparé), indexé par identifiant
  TMDB — dans le répertoire d'assets Kometa configuré, sans contacter le serveur
  multimédia. Votre instance Kometa existante applique les visuels à sa prochaine
  exécution. Une nouvelle application met l'entrée à jour sur place au lieu de la
  dupliquer.
- **Les deux.** Effectue le téléversement direct _et_ écrit le YAML Kometa, en
  enregistrant chaque résultat indépendamment afin qu'un échec partiel soit
  visible.

Un plan sans avertissement s'applique en un seul clic : lorsque l'aperçu ne
comporte aucune cible ignorée et au moins une écriture, PosterPilot émet la
confirmation pour vous dans la même action. La moindre omission fait revenir
l'étape de confirmation explicite, et **Appliquer et suivant** conserve toujours
sa boîte de dialogue.

Une seule application écrit **chaque emplacement préparé** — série, saisons et
épisodes — avec la ou les méthodes choisies. Pour le téléversement direct,
PosterPilot résout chaque enfant de saison et d'épisode sur le serveur multimédia
par son numéro et téléverse vers lui ; un emplacement préparé dont la saison ou
l'épisode n'a pas d'enfant correspondant sur le serveur est omis et signalé au
lieu de faire échouer toute l'application, et l'échec d'un enfant n'interrompt
jamais les autres. L'export Kometa imbrique les affiches de saisons préparées
sous `seasons:` (indexées par numéro de saison) et les cartes-titres d'épisodes
préparées sous `episodes:` (indexées par numéro d'épisode), aux côtés des
`url_poster` / `url_background` du niveau série. Un **arrière-plan** de saison
n'est appliqué que par la méthode directe — il est omis du YAML.

Chaque destination et chaque emplacement — succès ou échec — est consigné dans la
chronologie des visuels, en ajout seul, avec provenance sûre, état antérieur,
résultat, vérification et horodatage. Si une entrée liée change après l'aperçu,
la confirmation n'écrit rien et exige un nouvel aperçu. Lisez
[Sécurité, vérification et annulation](/posterpilot/fr/safety/) pour le contrat
complet.

### Comment Kometa consomme l'export

PosterPilot écrit un unique fichier de métadonnées (par défaut `posterpilot.yml`)
dans `KOMETA_ASSETS_DIR`, indexé par identifiant TMDB avec des entrées
`url_poster` / `url_background`. Ajoutez ce fichier à la configuration de
médiathèque de votre Kometa (par exemple sous `metadata_path` /
`metadata_files`) pour que Kometa applique les visuels à sa prochaine exécution.

## Historique des visuels et annulation

La chronologie d'un élément sépare les résultats serveur direct et Kometa pour
les emplacements série/film, saison et épisode. Utilisez une action disponible de
la chronologie pour prévisualiser l'annulation d'une révision, d'une saison ou de
l'élément entier. L'aperçu liste les restaurations exactes et les emplacements
indisponibles ; la confirmation ne restaure que cette portée figée, vérifie
lorsque c'est pris en charge, et ajoute une nouvelle révision d'annulation au
lieu de supprimer l'historique.

Une annulation partielle conserve les restaurations réussies et signale
indépendamment les emplacements en échec. Une image d'origine qui n'a pas pu
être capturée est étiquetée indisponible plutôt que présentée comme restaurable
en toute sécurité.

## Sets personnalisés

La vue détaillée d'un élément comporte un **compositeur** persistant et épinglé,
avec un emplacement d'affiche et un emplacement d'arrière-plan qui forment
ensemble un « set » personnalisé :

- Cliquer sur un candidat d'affiche l'envoie vers l'emplacement d'affiche ;
  cliquer sur un candidat d'arrière-plan l'envoie vers l'emplacement
  d'arrière-plan — automatiquement, selon son type.
- Chaque emplacement peut aussi être rempli à partir d'une **URL d'image
  collée** ou d'un **fichier image téléversé**. Le téléversement de fichier passe
  lui-même par un aperçu puis une confirmation, et valide le type et la taille.
- Appliquer le compositeur applique les deux pièces préparées en une seule action
  via la méthode de votre choix.

:::note[Les téléversements sont réservés au serveur]
Un visuel personnalisé basé sur une URL peut être appliqué à la fois via le
serveur multimédia et via Kometa. Un **fichier téléversé** ne peut être appliqué
que via le serveur multimédia — un téléversement binaire ne peut pas s'exprimer
sous forme d'URL dans le YAML Kometa ; il est donc omis de l'export Kometa et la
limitation est rendue visible au lieu d'écrire une entrée invalide.
:::

## Actions groupées

Sélectionnez la page courante ou **tous les résultats correspondants**, effacez
la sélection, et lancez la découverte et/ou l'application en tâche de fond.
« Tous les résultats correspondants » matérialise le résultat complet du filtre
côté serveur, et pas seulement les cartes chargées ; modifier la requête
invalide cette sélection.

La sélection automatique note chaque candidat parmi tous les fournisseurs
activés — en combinant qualité du fournisseur, résolution et adéquation du
ratio — et retient l'affiche la mieux notée (et un arrière-plan lorsqu'il en
existe un) pour chaque élément ; c'est la même notation qui pilote la
présélection suggérée dans la vue de l'élément. Les éléments ignorés sont exclus
de la sélection.

Avant l'exécution d'une application groupée, un **aperçu exact** fige les
identifiants cibles, les candidats sélectionnés, les téléversements, les exports
Kometa, les identités de l'état courant et les omissions. Il peut effectuer une
découverte non destructive pour construire le plan, mais la confirmation
n'exécute que les opérations figées. L'application groupée traite ensuite les
éléments **en parallèle** (dans la limite du paramètre de concurrence
d'application), si bien que les grands lots se terminent plus vite, avec la même
progression en direct et la même possibilité d'annulation.

## Expériences FUN

**FUN** est une section optionnelle dédiée aux expériences sur la médiathèque
(activez-la avec l'interrupteur FUN dans **Paramètres → Kometa & avancé**, ou
avec `FUN_ENABLED=true`). Tant qu'elle n'est pas activée, elle reste totalement
masquée — aucune entrée de navigation, et sa page renvoie une erreur 404.

Le hub comprend un sélecteur partageable à trois choix maximum (filtres,
préréglages, modes à l'aveugle et capsule), Poster Match, une galerie ambiante et
des sessions à budget de durée de deux ou trois films. Les résultats
n'appliquent jamais de visuels ; Poster Match ne fait que préparer son gagnant.
Avec la réduction des animations, la galerie démarre en pause. Voir
[Expériences FUN et collections](/posterpilot/fr/fun-collections/).

## Collections

**Collections** regroupe les membres locaux à partir de l'identité de collection
native du serveur ou de TMDB, strictement au sein du serveur actif. Les pages de
détail montrent la provenance, les membres indisponibles, les visuels
actuels/préparés, une cohérence explicable, une couverture coordonnée de la
famille, des surcharges par membre et une **relance de la recherche sur tous les
membres** en une seule action. Préparer une famille ne l'applique jamais.
Voir [Expériences FUN et collections](/posterpilot/fr/fun-collections/).

## Tableau de bord et tâches

Le **tableau de bord** est votre point de départ. Il affiche des cartes
actionnables de révision et de tâches, le bouton **Synchroniser**, et toute
tâche en cours avec une **barre de progression en direct** (mise à jour via
Server-Sent Events, sans rechargement nécessaire) que vous pouvez **annuler**.
Le badge de navigation à côté du tableau de bord reflète le nombre de tâches
actives. En dessous, un tableau **Tâches récentes** liste les dernières tâches
avec leur type, les compteurs traités/total, le résumé du résultat, les
tentatives et le statut final. Les échecs terminaux exposent un détail par cible
assaini et une nouvelle tentative pour le seul travail échoué éligible.
Il n'existe pas de page Tâches distincte — la progression en direct et
l'historique récent vivent tous deux sur le tableau de bord.

![Tableau de bord PosterPilot avec statistiques de la médiathèque, action de synchronisation et tâches de fond récentes](/posterpilot/screenshots/dashboard.webp)

## Journal d'activité

Le journal d'événements granulaire se trouve dans **Paramètres → Activité**.
Chaque événement opérationnel y est consigné (et reflété vers la console du
conteneur et un fichier journal à rotation). Vous pouvez :

- Filtrer par niveau — **Tous / Info / Avertissement / Erreur**.
- Parcourir l'historique avec **Charger plus**.
- **Effacer l'activité** pour vider le tableau intégré (cela ne supprime pas le
  fichier journal sur disque).

Le tableau est plafonné à `EVENT_RETENTION` lignes (par défaut `2000`) ; les
lignes plus anciennes sont purgées automatiquement. Voir
[Configuration → Journalisation et journal d'activité](/posterpilot/fr/configuration/)
pour les détails du fichier journal et de la rétention.
