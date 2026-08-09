---
title: Utilisation
description: Lancez l'assistant de configuration, synchronisez une médiathèque, réparez les correspondances TMDB, trouvez des visuels chez plusieurs fournisseurs, appliquez-les via l'API du serveur multimédia ou l'export Kometa, lisez la couverture des visuels, composez des sets personnalisés, filtrez et triez la médiathèque, et consultez le journal d'activité.
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
rapide que la première. Une catégorie d'éléments est délibérément exemptée de ce
saut : un élément dont l'identité TMDB stockée contredit le type film/série que
le serveur multimédia attribue lui-même à cet élément est toujours retraité, si
bien qu'une incohérence ancienne ne peut pas survivre indéfiniment aux
synchronisations incrémentales (voir
[Corriger une correspondance TMDB](#corriger-une-correspondance-tmdb)). Une
**Réanalyse complète**, qui retraite tout, reste disponible depuis le tableau de
bord, et vous pouvez désactiver entièrement la synchronisation incrémentale
(voir
[Configuration → Performances et réglages](/posterpilot/fr/configuration/)).

## Travailler depuis la boîte de révision

La **révision** est le flux titre par titre le plus rapide. Elle déduit des états
actionnables pour les éléments nouveaux, non résolus, sans candidat, avec
suggestion prête, préparés, en échec partiel, modifiés en externe, ignorés et
terminés. Filtrez par serveur/médiathèque/type/état/fournisseur, recherchez,
choisissez un tri déterministe, ou enregistrez le filtre courant comme vue
nommée. Un filtre de [couverture des visuels](#couverture-des-visuels) distinct
est placé à côté du filtre d'état et répond à une autre question : l'_état_ dit
où vous en êtes dans votre flux de travail, la _couverture_ dit ce qui s'est
réellement passé à une destination.

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

Tout ce qui suit — quels visuels sont seulement recherchés, quelle entrée Kometa
est écrite, comment deux copies d'un même titre sont reconnues comme le même
titre — dépend de l'identité TMDB que PosterPilot a résolue pour un élément.
Cette section explique comment obtenir la bonne identité, et comment la réparer
lorsqu'elle est fausse.

### La résolution automatique reste dans le bon espace de noms

TMDB numérote les films et les séries indépendamment : le film `105` et la série
`105` sont deux titres sans aucun rapport. Le serveur multimédia sait déjà lequel
des deux est un élément donné ; PosterPilot considère cette information comme
faisant autorité et ne résout **qu'à l'intérieur de cet espace de noms**.

- Les GUID portés par un élément sont essayés selon une précédence fixe : d'abord
  un identifiant TMDB direct, puis IMDb, puis TVDB.
- Un identifiant TMDB direct est validé en le relisant depuis le point de
  terminaison attendu — une série est cherchée comme série, un film comme film.
  Un identifiant qui n'existe que dans l'autre espace de noms ne résout pas.
- Un identifiant IMDb ou TVDB passe par le point de terminaison `find` de TMDB,
  et seul le lot de résultats correspondant est accepté : les résultats séries
  pour une série, les résultats films pour un film. Une correspondance trouvée
  dans l'autre lot est écartée plutôt qu'empruntée.

Concrètement, une médiathèque de séries ne peut plus être résolue vers des films.
Une réponse « pas dans cet espace de noms » de la part de TMDB laisse l'élément
**non résolu**, ce qui n'est pas le même résultat qu'un échec réseau ou
d'identifiants : ce dernier laisse l'élément non résolu _et_ non synchronisé, si
bien que la synchronisation suivante le retente au lieu d'accepter une mauvaise
réponse.

### La bannière de normalisation

Les versions antérieures à cette protection pouvaient stocker une identité TMDB
du mauvais type, et corriger le résolveur ne corrige pas rétroactivement les
lignes déjà présentes en base. Après une mise à jour, PosterPilot les compte donc
et le dit dans une bannière en haut de chaque page — _« … anciennes
correspondances TMDB doivent être normalisées. »_ — avec une action **Normaliser
les correspondances** et une note précisant que la réparation corrige l'identité
des films et séries sans analyse complète ni application d'illustrations.

Ce que ce compte inclut est étroit et délibéré :

- Uniquement les éléments du **serveur actif** dont le type de média TMDB stocké
  contredit le type que le serveur multimédia attribue lui-même à cet élément.
- **Pas** les éléments épinglés à la main — un épinglage est votre affirmation
  sur l'identité, et il prime sur toute réparation automatique.
- **Pas** les copies qui ont depuis quitté leur médiathèque.

Le nombre est recompté depuis la base de données à chaque affichage : restaurer
une sauvegarde ou modifier des lignes à la main ne demande donc aucune réparation
de drapeau séparée, et la bannière disparaît d'elle-même dès qu'il n'y a plus
rien en attente.

**Normaliser les correspondances** met en file une tâche de réparation limitée
exactement à ces éléments. Elle re-résout chacun d'eux dans le bon espace de noms
et réenrichit ses métadonnées, et c'est tout : elle n'applique aucun visuel, ne
touche pas aux sélections préparées et ne parcourt pas le reste de la
médiathèque. Pendant l'exécution, la bannière indique la progression et renvoie
vers la tâche sur le tableau de bord ; une tâche terminée en échec, partielle,
annulée ou interrompue transforme la commande en **Relancer la normalisation**.
Une seule tâche de réparation par serveur peut s'exécuter à la fois — en lancer
une seconde nomme la tâche qui détient déjà cette portée.

### Pourquoi la réanalyse complète est le repli, pas la réparation

La **Réanalyse complète** du tableau de bord relit l'intégralité de la
médiathèque du serveur : chaque élément est réconcilié, re-résolu, réenrichi, et
ses visuels actuels sont réobservés (tout ce qui a changé sur le serveur est
signalé pour révision). Elle préserve les originaux et l'historique, et
n'applique jamais de visuels automatiquement. C'est le bon outil quand vous
soupçonnez que le cache local a dérivé dans son ensemble — après la restauration
d'une sauvegarde, ou après des modifications massives faites directement sur le
serveur multimédia.

C'est le mauvais outil pour des identités erronées, et ce pour deux raisons :

1. **PosterPilot sait déjà nommer les éléments concernés.** La réparation ciblée
   ne touche que ces lignes ; une réanalyse complète paie un passage entier sur
   la médiathèque et une salve complète de requêtes vers le serveur multimédia et
   TMDB pour aboutir au même résultat.
2. **Attendre fonctionne aussi.** Une incohérence de type en attente est exemptée
   du saut incrémental : une synchronisation ordinaire retraite donc ces éléments
   dès qu'elle les atteint. La tâche de réparation sert à les corriger
   _maintenant_, ce n'est pas le seul moyen de les voir corrigés un jour.

Réservez la réanalyse complète à la question « ma copie locale est-elle encore
fidèle dans son ensemble ? » — et pas au cas où la réponse tient déjà dans une
liste.

### Épingler une correspondance à la main

Un élément non résolu ou mal apparié peut faire l'objet d'une recherche manuelle
par titre, année et type film/série. Les résultats incluent l'identité TMDB et
des métadonnées de désambiguïsation.

Confirmer relit cette identité exacte depuis TMDB juste avant toute écriture : un
candidat disparu entre la recherche et la confirmation est donc refusé plutôt
qu'épinglé, et un TMDB injoignable laisse votre correspondance actuelle intacte.
Une confirmation réussie épingle l'identité, invalide les candidats découverts
sous l'ancienne et enregistre un événement d'audit. **Aucun visuel n'est
appliqué** — relancez **Trouver des visuels** pour découvrir les visuels de la
nouvelle identité.

Un épinglage fait autorité : les synchronisations ne l'écrasent pas et la passe
de normalisation l'ignore. Le remplacer ou l'effacer est tout aussi explicite.
L'effacer relance immédiatement la résolution automatique à partir des seuls
identifiants IMDb/TVDB stockés de l'élément — la colonne d'identifiant TMDB
appartenait à l'épinglage, seuls ces identifiants indépendants peuvent donc être
réutilisés sans risque — et indique ce qui s'est produit : une correspondance
automatique a été rétablie, aucune correspondance n'a été trouvée, ou la
résolution n'a pas pu s'exécuter. Un élément qui ne porte ni l'un ni l'autre
redevient simplement éligible, et une synchronisation ultérieure pourra fournir
un nouveau GUID TMDB. Chaque transition (épinglée, remplacée, effacée, résolue,
non résolue) est conservée dans la piste d'audit des correspondances de
l'élément.

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
- **Filtrer par couverture des visuels** — _Appliqué sur ce serveur_, _Exporté
  vers Kometa_, _Aucun visuel appliqué_ ou _Couverture inconnue_. La révision propose
  exactement le même contrôle, et les valeurs y ont le même sens : un lien reste
  donc transposable d'une vue à l'autre. Lisez
  [Couverture des visuels](#couverture-des-visuels) avant de vous y fier — ce
  sont des affirmations sur ce que PosterPilot a fait, pas sur le fait qu'un
  titre possède ou non une affiche.
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
- **Les cartes de fournisseurs apparaissent dans l'ordre que vous avez
  configuré** dans Paramètres → Métadonnées et fournisseurs — et non dans l'ordre
  où la découverte s'est trouvée terminer, qui n'enregistre rien d'autre que le
  fournisseur ayant répondu en premier. Cet ordre relève de la présentation, plus
  d'un départage entre candidats à score _exactement_ égal ; il ne renverse
  jamais un score inégal, si bien qu'une image plus nette venue d'un fournisseur
  que vous avez placé en dernier remporte quand même la suggestion. Voir
  [Configuration → Ordre des fournisseurs](/posterpilot/fr/configuration/).
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

### Afficher plus sans tout charger

Un blockbuster peut porter des centaines de visuels, et les afficher tous d'un
coup coûte cher, que vous descendiez jusque-là ou non. Chaque grille s'ouvre donc
sur **24 vignettes**, et une commande **charger plus** en révèle 24 de plus (ou
ce qu'il reste) tout en indiquant combien resteraient masqués après cela. 24
parce que ce nombre se divise exactement dans chacune des grilles utilisées par
la page — deux colonnes pour les arrière-plans, quatre pour les cartes-titres,
huit pour les affiches de saisons — de sorte qu'une révélation ne laisse jamais
une demi-ligne bancale. La ligne placée à côté de la commande énonce toujours
l'arithmétique : combien sont affichés, sur combien, et combien sont masqués.

Chaque grille se déploie **indépendamment** : révéler d'autres affiches ne révèle
pas d'arrière-plans, deux sets du même fournisseur se déploient séparément, et
les affiches comme les cartes-titres de chaque saison gardent leur propre compte.
Les vignettes non révélées ne sont pas affichées du tout plutôt que chargées
paresseusement, car une image en chargement différé coûte quand même un élément.

En révéler davantage ne coûte rien sur le réseau : tout l'inventaire conservé
pour l'élément est déjà dans la page. Ce que la grille ne sait pas faire, c'est
aller au-delà de ce que PosterPilot a **conservé**. TMDB renvoie toutes les
images qu'il détient, et l'ingestion applique un plafond défensif de 200
candidats par type de visuel ; quand une grille est à ce plafond, elle le dit —
_« … a renvoyé plus de visuels que PosterPilot n'en conserve ; cette grille n'est
pas la liste complète. »_ — au lieu de laisser croire que vous voyez tout ce qui
existe. Voir
[Configuration → Inventaire des candidats et bouton « charger plus »](/posterpilot/fr/configuration/).

### Agrandir un candidat

Chaque vignette porte sa propre commande **⤢ agrandir** sous l'image, distincte
de celle qui la prépare. Agrandir, c'est regarder, jamais choisir : cela ne
prépare rien, ne persiste rien et ne modifie aucun emplacement.

![L'aperçu agrandi montrant une affiche en entier, avec son fournisseur, ses dimensions et sa langue, et les commandes précédent/suivant](/posterpilot/screenshots/artwork-preview.webp)

La fenêtre affiche le **fichier canonique** — exactement celui qui serait
téléversé vers votre serveur ou écrit dans le YAML Kometa — complet et non
recadré, avec la provenance qu'une simple image ne peut pas porter : fournisseur,
dimensions en pixels, et langue lorsque le fournisseur en indique une. Les
fournisseurs qui n'étiquettent jamais de langue (MediUX, ThePosterDB) n'ont
aucune ligne de langue, car « aucune langue indiquée » décrirait la source plutôt
que le visuel.

- **← / →** ou les touches fléchées parcourent la séquence ; **Échap** ou le ✕ la
  ferment et rendent le focus à la vignette d'où vous l'avez ouverte.
- Votre position dans la séquence est affichée entre les commandes et annoncée à
  chaque changement, et les commandes **s'arrêtent aux extrémités** au lieu de
  boucler — un Suivant qui reviendrait au premier contredirait la position que
  vous êtes en train de lire.
- La séquence est exactement ce qui est à l'écran : le même ordre de
  fournisseurs, les mêmes sets dépliés, le même filtre de langue, les mêmes
  vignettes révélées. Suivant ne peut jamais atteindre un visuel que la page
  elle-même masque.
- Si la grille change sous un aperçu ouvert — vous avez révélé un lot
  supplémentaire, une tâche de fond s'est terminée — la fenêtre suit le visuel
  que vous étiez en train de regarder. Elle ne se ferme que s'il n'y a plus rien
  à montrer.
- Un fichier qui ne peut pas être chargé en pleine taille le dit, au lieu
  d'afficher l'image du candidat précédent sous la légende du nouveau.

### Ce que la navigation télécharge réellement

Chaque candidat a un fichier **canonique** — celui qui serait réellement
appliqué — et certains fournisseurs publient à côté une version réduite.
PosterPilot choisit délibérément lequel il récupère, et à quel moment :

- **Les grilles** demandent la version optimisée partout où un fournisseur en
  propose une — TMDB fournit une affiche en `w500` et un arrière-plan en `w1280`
  plutôt que l'original — et la font passer par le cache de miniatures de
  PosterPilot : ces octets sont donc récupérés une seule fois chez le fournisseur
  puis réutilisés d'un chargement de page à l'autre, d'un élément à l'autre, et
  entre tous les utilisateurs de cette instance. MediUX, Fanart.tv et
  ThePosterDB ne publient pas d'aperçu séparé ; leurs vignettes affichent donc
  l'URL canonique — toujours à travers ce cache, si bien que les parcourir
  plusieurs fois ne sollicite pas le fournisseur à chaque fois.
- **L'aperçu agrandi et le chemin d'application** utilisent le fichier canonique,
  récupéré directement chez le fournisseur. L'aperçu contourne délibérément le
  cache de miniatures : ce cache existe pour stocker des images de la taille des
  grilles, et le remplir d'originaux évincerait justement les miniatures qu'il
  est là pour servir.

L'image agrandie n'existe que tant que la fenêtre est ouverte : une grille de
cent vignettes TMDB télécharge donc cent miniatures et zéro original tant que
vous n'en demandez pas un. Pour les fournisseurs qui ne publient aucune version
réduite, l'unique récupération mise en cache par la grille reste la seule, quel
que soit le nombre de fois où vous revenez sur l'élément. La durée de vie et la
taille du cache sont à vous de régler — voir
[Configuration → Performance et réglages](/posterpilot/fr/configuration/).

### Langue des visuels

Lorsqu'une langue de visuels TMDB est configurée, la page de l'élément filtre les
grilles sur cette langue et le dit au-dessus d'elles — en nommant la langue, et
en indiquant combien de visuels elle masque dans d'autres langues — avec un
basculement **Afficher toutes les langues** local à la page, qui ne modifie
jamais votre préférence enregistrée. Si rien ne correspond pour ce titre, la page
indique combien de visuels existent dans d'autres langues et propose la même
échappatoire, au lieu de vous montrer une grille vide.

La préférence gouverne **uniquement les visuels TMDB**, et le raisonnement vaut
d'être connu avant de la définir : voir
[Configuration → Langue des visuels TMDB](/posterpilot/fr/configuration/).

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

PosterPilot écrit `posterpilot-movies.yml` et `posterpilot-shows.yml` dans son
répertoire de sortie Kometa. Les films utilisent les identifiants TMDB, avec IMDb
comme solution de repli ; les séries, TVDB avec le même repli vers IMDb. Ajoutez le fichier correspondant
à chaque médiathèque sous `metadata_files`. Le
[gestionnaire Kometa](../kometa-config-sync/) peut maintenir ces références et
explique la différence entre le chemin physique et le préfixe `file:` visible par
le runtime Kometa.

## Couverture des visuels

La chronologie des visuels répond à la question _qu'a fait PosterPilot_. La
couverture répond à une autre question — _qu'est-ce qui est vrai en ce moment_ —
et les deux peuvent être en désaccord, ce qui est précisément la raison pour
laquelle elles sont séparées. Chaque page d'élément porte un panneau **Couverture
des visuels** sous le bandeau, et le mur de la médiathèque comme la révision
peuvent être filtrés dessus.

![Le panneau de couverture des visuels sur un élément, avec le serveur multimédia et les métadonnées Kometa signalés séparément](/posterpilot/screenshots/item-coverage.webp)

### Deux destinations, jamais fusionnées

La couverture est toujours signalée **par destination**, dans deux panneaux côte
à côte :

- **Serveur multimédia** — les visuels que PosterPilot a téléversés vers Plex,
  Jellyfin ou Emby.
- **Métadonnées Kometa** — les entrées que PosterPilot a écrites dans ses
  fichiers YAML Kometa.

Les deux panneaux ne sont jamais repliés en un verdict unique, et leurs comptes
ne sont jamais additionnés. C'est la distinction que tout ce panneau existe pour
protéger :

:::caution[Exporter vers Kometa n'est pas appliquer un visuel]
Un export est une ligne dans un fichier YAML sur disque. Écrire cette ligne
prouve que le fichier a été écrit. Cela ne prouve pas que Kometa se soit exécuté,
ni que Kometa ait lu le fichier, ni que votre serveur multimédia ait accepté le
résultat, ni que l'URL réponde encore. PosterPilot le dit dans le panneau —
_« Exporté vers un fichier Kometa. PosterPilot ne peut pas confirmer que Kometa
l'a appliqué. »_ — et il ne promeut jamais un export en affirmation côté serveur.
Si vous appliquez avec la seule méthode Kometa, le panneau Serveur multimédia
continuera d'indiquer que rien n'y a été appliqué : c'est un énoncé correct, pas
un bug.
:::

La même règle gouverne les copies d'un titre. Un film présent sur deux serveurs,
ou deux fois sur un même serveur parce qu'il figure à la fois dans `Films` et
`Films 4K`, constitue plusieurs copies aux preuves indépendantes — une affiche
appliquée à l'une ne prouve rien pour l'autre. Lorsqu'un titre a plusieurs
copies, l'en-tête indique le compte **par destination** (« 1 sur 2 copies
couvertes »), jamais un chiffre combiné unique : une copie appliquée à un serveur plus
une autre copie exportée vers Kometa, cela ne fait pas « 2 sur 2 ».

Chaque emplacement à l'intérieur d'un panneau — l'affiche, l'arrière-plan, chaque
saison, chaque épisode — conserve lui aussi son propre statut. Une série dont
l'affiche est vérifiée sur le serveur et dont les cartes-titres d'épisodes ne le
sont pas dit exactement cela, au lieu de se résoudre en un badge unique.

### Ce que signifie chaque état

| État                                 | Signification                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Appliqué sur ce serveur**          | Nous l'avons écrit, et l'empreinte que nous attendions correspond encore à ce que le serveur sert en ce moment. C'est le seul état qui soit une preuve positive et vérifiée sur un serveur multimédia. |
| **Exporté vers Kometa**              | Le fichier de métadonnées actuel porte l'URL de cet emplacement. Un fichier sur disque — voir l'avertissement ci-dessus.                                                                               |
| **Appliqué, non vérifié**            | Nous l'avons écrit, et l'état actuel du serveur n'a pas pu être vérifié. L'historique existe ; la preuve, non.                                                                                         |
| **Modifié en dehors de PosterPilot** | Nous l'avons écrit, et quelque chose l'a remplacé depuis. C'est un état à part entière, pas un synonyme d'autre chose.                                                                                 |
| **Non appliqué par PosterPilot**     | Une observation fiable n'a trouvé aucune trace indiquant que nous ayons posé un visuel ici.                                                                                                            |
| **Couverture inconnue**              | Nous n'avons pas pu observer de façon fiable — un fichier Kometa illisible, un serveur multimédia injoignable, un historique incomplet.                                                                |

Trois de ces formulations portent tout le sens, et les lire à peu près vous
induira en erreur :

**« Non appliqué par PosterPilot » ne veut pas dire « n'a pas de visuel ».** C'est
un énoncé sur ce que _nous_ avons fait, jamais sur ce que votre serveur détient.
Un titre dont vous avez choisi l'affiche à la main dans Plex il y a des années
s'affiche ici comme non appliqué par PosterPilot — et il a une affiche
parfaitement valable. Il n'existe délibérément aucun état de couverture, et
aucune valeur de filtre, qui affirme qu'un titre n'a pas de visuel : PosterPilot
ne peut pas le savoir.

**« Modifié en dehors de PosterPilot » est une réponse en soi.** Quelque chose a
remplacé notre visuel — l'agent de Plex lui-même, un autre outil, une personne.
Lire cela comme « manquant » et réappliquer, c'est ne jamais découvrir ce qui
écrase sans cesse votre médiathèque.

**Une lecture qui échoue donne « inconnue », jamais « non appliqué ».** « Nous
n'avons pas pu vérifier » et « nous avons vérifié et ce n'est pas là » sont deux
faits différents, et les confondre est la façon dont une médiathèque entièrement
couverte se retrouve signalée comme vide, avec une invitation à tout réexporter.
Un fichier Kometa illisible, un répertoire que PosterPilot ne parvient pas à
résoudre, ou un historique qu'il n'a pas pu lire en entier produisent donc
_inconnue_ — un fichier absent, lui, est une observation fiable et ne la produit
pas.

### Filtrer par couverture

![Le mur de la médiathèque filtré sur les titres qui n'ont pas reçu de visuel](/posterpilot/screenshots/library-coverage-filter.webp)

Le mur de la médiathèque et la révision partagent un unique contrôle **Couverture
des visuels** :

- **Appliqué sur ce serveur** — au moins un emplacement est vérifié sur le
  serveur actif.
- **Exporté vers Kometa** — au moins un emplacement figure dans le fichier de
  métadonnées actuel.
- **Aucun visuel appliqué** — couvert à _aucune_ des deux destinations. Les
  titres auxquels PosterPilot n'a jamais touché correspondent à ce filtre, ce
  qu'une simple consultation de statut ne saurait obtenir. Le nom dit bien ce
  qu'il affirme : _nous_ n'avons rien posé, ni sur le serveur ni dans Kometa —
  cela ne dit rien sur le fait que le titre possède ou non une affiche.
- **Couverture inconnue** — au moins un emplacement dont la preuve est
  indéterminée : _Couverture inconnue_ à l'une ou l'autre destination, ou
  _Appliqué, non vérifié_ sur le serveur.

Notez le « au moins un emplacement » : une série dont l'affiche est appliquée et
qui n'a aucune carte-titre correspond à _Appliqué sur ce serveur_. Le filtre
trouve les titres qui méritent d'être ouverts ; c'est dans le panneau de la page
de l'élément que vit la vérité emplacement par emplacement. La couverture est
rattachée au serveur auquel appartient la copie : changer de serveur actif change
donc les réponses. Quand un filtre ne correspond à rien, l'état vide le dit et
propose un retour en un clic vers _N'importe quelle couverture_, plutôt que de
vous laisser devant une grille blanche à chercher quel contrôle l'a vidée.

### Comment la couverture reste à jour

La couverture est une projection reconstruite à partir de trois sources qui ne
lui appartiennent pas : le registre de révisions en ajout seul, l'observation
actuelle de votre serveur emplacement par emplacement, et les fichiers Kometa sur
disque. Elle est redérivée après une application, une annulation, une
synchronisation, ainsi qu'après une migration ou une écriture de configuration
Kometa — et, comme rien ne prévient PosterPilot quand quelqu'un change l'affiche
d'un titre directement dans Plex, une page d'élément dont les preuves ont plus de
**15 minutes** réobserve le serveur au moment où vous l'ouvrez.

Deux conséquences découlent de cette conception, et toutes deux sont
intentionnelles :

- **Un rafraîchissement ne fait jamais échouer ce qui l'a déclenché.** Une
  application qui a réussi puis n'a pas pu mettre la projection à jour reste une
  application réussie. Le prix à payer est une donnée un peu périmée, que le
  déclencheur suivant répare.
- **Réconcilier la couverture ne change rien d'autre.** Cela n'écrit aucun
  visuel, aucun YAML, aucune correspondance, et cela ne marque jamais quoi que ce
  soit comme révisé. Où vous en êtes dans votre file d'attente est votre
  affirmation ; ce qui est vrai à une destination est celle de PosterPilot — et
  l'une ne doit pas modifier l'autre.

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
