# Dictée des rapports de chantier

## Dicter un rapport

Ouvrez **http://localhost:8000** sur cet ordinateur. Choisissez la date, passez aux données du chantier et ouvrez **Dicter mon rapport**. Saisissez votre code privé, cliquez sur **Enregistrer**, autorisez le microphone et dictez. **Terminer et analyser** envoie l’audio au Worker. **Compléter ou corriger** permet de reprendre le texte avant validation.

Relisez chaque destination, la valeur actuelle et l’extrait. Décochez les propositions à écarter. **Valider le remplissage** écrit la sélection dans le vrai formulaire et déclenche sa sauvegarde habituelle. **Annuler les dernières modifications de dictée** est disponible pendant la session et restaure le lot le plus récent. Si vous avez déjà corrigé manuellement un champ, l’annulation conserve votre correction.

Le microphone permet d’enregistrer et de réécouter jusqu’à cinq minutes, dans la limite de 8 Mio. L’audio et la transcription sont temporaires. Fermer la fenêtre de dictée les efface. Pour tester le micro, utilisez un navigateur qui autorise l’enregistrement, sur HTTPS ou sur localhost. Le mode local effectue zéro requête de dictée. Le chargement initial des bibliothèques PDF utilise le CDN habituel du site.

## Formulaire et conservation des données

| Élément | Comportement de la dictée |
| --- | --- |
| Description du projet et champs projet personnalisés | Permanents. Les valeurs et les intitulés restent manuels. |
| Date choisie, titre du rapport, transmission, logo, photos, légendes et mise en page | Réservés à la saisie manuelle. |
| Personnel et stock | Journaliers par défaut. La dictée peut proposer un effectif ou un état de stock pour une ligne nommée, ou proposer une nouvelle ligne. Le nom d’une ligne existante est protégé. Un article sans quantité explicite peut garder sa quantité vide. |
| Rubrique de tableau personnalisée ou section libre | La case **Contenu journalier · autoriser la dictée** règle l’autorisation. Le texte validé s’ajoute au contenu existant et conserve sa mise en forme. |
| Ancienne rubrique personnalisée | Protégée jusqu’à ce que vous cochiez son autorisation. Les nouvelles rubriques personnalisées sont journalières par défaut. |
| Rubrique exclue du PDF | Écartée des propositions tant qu’elle est décochée. Son contenu reste disponible dans le formulaire. |

`index.html` contient le formulaire, les éditeurs de texte enrichi et le moteur d’export. La clé de sauvegarde reste `pvDataChantier`. Les autorisations de dictée et les identifiants stables des lignes complètent les enregistrements existants. Les anciennes sauvegardes reçoivent ces identifiants en mémoire lors de la lecture. Les images de chantier restent en mémoire pendant la session, leurs noms et légendes sont sauvegardés comme auparavant.

`dictee/champs.js` construit le catalogue à partir du formulaire courant. Chaque champ a un identifiant, une rubrique, un intitulé, un type et une catégorie. Seuls les descripteurs journaliers autorisés sont envoyés au classement. Le Worker reçoit les intitulés nécessaires, la transcription ou l’audio selon la route. Les images, le logo et le contenu antérieur des champs restent dans le navigateur.

`collectData()` reste la source utilisée pour l’export. jsPDF et AutoTable produisent le document A4 avec le tableau, les sections libres et les images. PDF.js rend les pages du même fichier pour l’aperçu. Une dictée validée ou annulée invalide le PDF précédent. L’ouverture du microphone et les corrections dans la transcription préservent l’aperçu du rapport courant.

## Adresse et maintenance

Le Worker déployé est `https://pvvc-dictee.medbahnaji44.workers.dev`. Le site local utilise cette adresse dans `dictee/interface.js`. Pour renouveler le code d’accès, exécutez `npx wrangler@4 secret put PVVC_ACCESS_CODE` depuis `worker` et saisissez le nouveau code à l’invite masquée.

Pour relancer le site local depuis la racine du projet sur cet ordinateur, utilisez PowerShell.

```powershell
& "$env:LOCALAPPDATA/PVVC-Tools/node-v24.22.3-win-x64/node.exe" tmp/servir-local.cjs
```

Workers Free inclut 10 000 neurones par jour pour l’ensemble du compte. Les modèles partagent cette allocation. Son renouvellement a lieu à 00 h 00 UTC. Le Worker limite les codes invalides à cinq tentatives par minute et par IP. Les appels autorisés partagent une limite de six par minute. Cloudflare applique ces compteurs approximativement dans chaque centre de données. Un refus de fréquence précède l’appel aux modèles. [Quota gratuit](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Fonctionnement des limites](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## Modèles et contrôles

- `POST /transcribe` accepte WebM, Ogg et MP4 audio. Whisper Large V3 Turbo reçoit l’audio en base64 avec détection de la parole et langue automatique. [Fiche Whisper](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)
- `POST /analyze` utilise Llama 3.3 70B Instruct FP8 Fast. Le modèle reçoit la transcription, les destinations autorisées et le lexique. Il renvoie un tableau JSON de propositions avec une destination, une valeur, un éventuel nouvel intitulé de ligne et un extrait exact de la transcription. Le Worker et le navigateur vérifient indépendamment le résultat. Une réponse invalide est rejetée en bloc. [Modèle de classement](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) · [Mode JSON](https://developers.cloudflare.com/workers-ai/features/json-mode/)
- Les effectifs numériques doivent être présents en chiffres dans l’extrait, y compris en chiffres arabes. Si Whisper écrit un effectif en toutes lettres, corrigez-le en chiffres avant de relancer l’analyse. Le contrôle vérifie aussi les chiffres des notes, la présence de l’extrait et le vocabulaire des unités dans les quantités. L’interprétation du sens, des négations et des changements de langue demande une relecture humaine.
- `dictee/lexique.js` contient des termes de chantier franco-arabes et de premières entrées hassaniya contextualisées. Complétez-le avec les appellations employées par vos équipes après les essais sur le terrain. Les entrées hassaniya s’appuient sur le lexique mauritanien du programme Twize. [Gret, annexe 2](https://gret.org/wp-content/uploads/2021/12/ETli32_integral-VF.pdf)
- Une analyse accepte jusqu’à 12 000 caractères de transcription, 350 destinations et 120 propositions. Un quota atteint, un service indisponible ou une réponse non vérifiable laisse le formulaire en l’état. Les photos et la rédaction manuelle restent accessibles.

## Vérifications reproductibles

Depuis la racine, `node --test tmp/qa-worker.mjs` teste le contrat et les routes avec une liaison IA de test. `node tmp/qa-dictee.cjs` utilise Playwright et Microsoft Edge dans un profil temporaire, avec un microphone virtuel. Cette suite charge les dépendances PDF habituelles du site et exécute aussi les contrôles historiques du dossier `tmp`. Les fichiers PDF et les captures précédemment enregistrés sous `tmp/qa` sont des références.
