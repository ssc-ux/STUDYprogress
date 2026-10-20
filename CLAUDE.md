# STUDYprogress

Site statique (GitHub Pages, branche `main`) qui répertorie les études cliniques en médecine interne
(source : ClinicalTrials.gov) pour des médecins, avec les études à promotion française mises en avant.

- `index.html` : tout le site (CSS + JS inline, même style que la PNDSthèque).
- `scripts/conditions.mjs` : maladies suivies, catégories, détection des promoteurs français.
- `scripts/update.mjs` : collecte → `data/studies.json` (index léger), `data/s/<NCT>.json` (fiche complète),
  `data/todo.json` (fiches en français à rédiger, par ordre de priorité).
- `data/fr/<NCT>.json` : fiches en français (cache ; ne jamais les supprimer).

## Mise à jour hebdomadaire (tâche Claude du lundi)

1. `node scripts/update.mjs` (aucune dépendance npm nécessaire). En cas d'échec réseau, réessayer ;
   si la collecte échoue encore, s'arrêter sans rien pousser.
2. Lire `data/todo.json` et rédiger les **60 premières** fiches de la liste (elle est triée : nouvelles
   études françaises d'abord). Pour chaque entrée, lire `data/s/<id>.json` et écrire `data/fr/<id>.json`
   au format ci-dessous, avec le champ `h` recopié tel quel depuis `todo.json`. Paralléliser avec des
   sous-agents (lots d'environ 10 fiches).
3. `OFFLINE=1 node scripts/update.mjs` pour intégrer les fiches.
4. Vérifier que `data/studies.json` se charge (`node -e 'require("./data/studies.json")'`), puis
   `git add -A && git commit -m "Mise à jour hebdomadaire des études (AAAA-MM-JJ)" && git push origin main`.
5. Résumer en quelques lignes : nombre d'études, nouvelles études françaises, changements de statut, fiches rédigées.

## Format d'une fiche `data/fr/<id>.json`

```json
{
 "h": "<copié depuis todo.json>",
 "date": "AAAA-MM-JJ",
 "titre": "Titre court en français (< 110 caractères), sans l'acronyme",
 "question": "La question posée par l'étude, en une phrase",
 "contexte": "6 à 9 phrases, un ou deux paragraphes séparés par une ligne vide (\n\n)",
 "interet": "Ce que l'étude pourrait changer en pratique, 2 à 4 phrases",
 "profil": "La population étudiée, en une phrase (« Des adultes… »)",
 "inclusion": ["4 à 7 critères d'inclusion clés, courts"],
 "exclusion": ["4 à 7 critères d'exclusion clés, courts"],
 "bras": [{ "nom": "Bras A ou groupe", "traitement": "Molécule, dose, rythme" }],
 "duree": "Durée de participation ou de suivi par patient, ex. « 52 semaines »",
 "critere": "Critère de jugement principal reformulé simplement, avec son délai"
}
```

Règles de rédaction (lecteurs : médecins français qui veulent s'informer en une minute ; le site informe sur la recherche, il ne sert pas à orienter des patients) :
- Français médical clair, phrases courtes. DCI pour les molécules, abréviations usuelles (GPA, PAM, ACG, PTI…).
- **Contexte détaillé** : la maladie et le besoin non couvert, ce que montrent les données et recommandations
  actuelles, le rationnel de l'intervention (mécanisme, résultats préliminaires), ce qu'apporte cette étude
  par rapport à l'existant (population, comparateur, design), le promoteur ou réseau quand c'est utile.
  Les connaissances médicales générales sont permises pour situer le contexte ; ne jamais inventer de
  résultats de l'étude ni de chiffres absents du registre.
- Critères : condensés depuis le registre, sans en ajouter. Information absente : « non précisé ».
- Étude observationnelle : `bras` décrit les groupes ou cohortes suivis.
