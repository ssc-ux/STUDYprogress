// Maladies suivies : libellé français, catégorie (mêmes familles que la PNDSthèque)
// et requête ClinicalTrials.gov (syntaxe Essie de query.cond).
export const CATS = ["Connectivites", "Vascularites", "Auto-inflammatoires", "Granulomatoses et histiocytoses", "Hémato-immunologie", "Déficits immunitaires", "Autres"];

export const DISEASES = [
  { id: "lupus", fr: "Lupus systémique", cat: "Connectivites", q: '"systemic lupus erythematosus" OR "lupus nephritis" OR "cutaneous lupus erythematosus"' },
  { id: "sapl", fr: "Syndrome des antiphospholipides", cat: "Connectivites", q: '"antiphospholipid syndrome"' },
  { id: "ssc", fr: "Sclérodermie systémique", cat: "Connectivites", q: '"systemic sclerosis" OR "diffuse cutaneous scleroderma"' },
  { id: "sjogren", fr: "Maladie de Sjögren", cat: "Connectivites", q: 'Sjogren' },
  { id: "myosites", fr: "Myopathies inflammatoires", cat: "Connectivites", q: 'dermatomyositis OR polymyositis OR "idiopathic inflammatory myopathy" OR "antisynthetase syndrome" OR "necrotizing myopathy" OR "inclusion body myositis"' },
  { id: "anca", fr: "Vascularites à ANCA", cat: "Vascularites", q: '"ANCA-associated vasculitis" OR "granulomatosis with polyangiitis" OR "microscopic polyangiitis" OR "eosinophilic granulomatosis with polyangiitis"' },
  { id: "acg", fr: "Artérite à cellules géantes et PPR", cat: "Vascularites", q: '"giant cell arteritis" OR "polymyalgia rheumatica"' },
  { id: "takayasu", fr: "Artérite de Takayasu", cat: "Vascularites", q: 'Takayasu' },
  { id: "behcet", fr: "Maladie de Behçet", cat: "Vascularites", q: 'Behcet' },
  { id: "vasc-autres", fr: "PAN, IgA, cryoglobulinémies", cat: "Vascularites", q: '"polyarteritis nodosa" OR "IgA vasculitis" OR "cryoglobulinemic vasculitis" OR "urticarial vasculitis"' },
  { id: "still", fr: "Maladie de Still", cat: "Auto-inflammatoires", q: '"adult-onset Still disease" OR "Still disease" OR "systemic juvenile idiopathic arthritis"' },
  { id: "fievres", fr: "Fièvres récurrentes héréditaires", cat: "Auto-inflammatoires", q: '"familial Mediterranean fever" OR "cryopyrin-associated periodic syndrome" OR "TNF receptor-associated periodic syndrome" OR "mevalonate kinase deficiency"' },
  { id: "vexas", fr: "Syndrome VEXAS", cat: "Auto-inflammatoires", q: 'VEXAS' },
  { id: "autoinfl", fr: "Autres auto-inflammatoires", cat: "Auto-inflammatoires", q: '"Schnitzler syndrome" OR "AA amyloidosis" OR "recurrent pericarditis" OR "autoinflammatory disease"' },
  { id: "sarcoidose", fr: "Sarcoïdose", cat: "Granulomatoses et histiocytoses", q: 'sarcoidosis' },
  { id: "igg4", fr: "Maladie associée aux IgG4", cat: "Granulomatoses et histiocytoses", q: '"IgG4-related disease"' },
  { id: "histio", fr: "Histiocytoses et Castleman", cat: "Granulomatoses et histiocytoses", q: '"Erdheim-Chester" OR "Langerhans cell histiocytosis" OR "Rosai-Dorfman" OR "Castleman disease"' },
  { id: "pti", fr: "Purpura thrombopénique immunologique", cat: "Hémato-immunologie", q: '"immune thrombocytopenia" OR "immune thrombocytopenic purpura"' },
  { id: "ahai", fr: "Anémies hémolytiques auto-immunes", cat: "Hémato-immunologie", q: '"autoimmune hemolytic anemia" OR "cold agglutinin disease" OR "Evans syndrome"' },
  { id: "ptt", fr: "Purpura thrombotique thrombocytopénique", cat: "Hémato-immunologie", q: '"thrombotic thrombocytopenic purpura"' },
  { id: "hlh", fr: "Syndromes d'activation macrophagique", cat: "Hémato-immunologie", q: '"hemophagocytic lymphohistiocytosis" OR "macrophage activation syndrome"' },
  { id: "mastocytose", fr: "Mastocytoses", cat: "Hémato-immunologie", q: 'mastocytosis' },
  { id: "dip", fr: "Déficits immunitaires primitifs", cat: "Déficits immunitaires", q: '"common variable immunodeficiency" OR "primary immunodeficiency" OR "inborn errors of immunity" OR "activated PI3K delta syndrome"' },
  { id: "amylose", fr: "Amyloses AL et ATTR", cat: "Autres", q: '"AL amyloidosis" OR "transthyretin amyloidosis"' },
  { id: "polychondrite", fr: "Polychondrite chronique atrophiante", cat: "Autres", q: '"relapsing polychondritis"' },
  { id: "uveite", fr: "Uvéites non infectieuses", cat: "Autres", q: '"non-infectious uveitis"' }
];

// Promoteur (ou investigateur coordinateur) français : institutions et villes hospitalo-universitaires.
export const FR_RE = /\b(france|french|fran[cç]ais(es?)?|ap-?hp|assistance publique|hospices civils|hôpitaux? de|h[oô]pital|centre hospitalier|groupe hospitalier|chu\b|chru\b|chr\b|inserm|anrs|unicancer|institut (pasteur|curie|imagine|gustave roussy)|fondation (adolphe de )?rothschild|gfev|fai2r|paris|lyon|lille|toulouse|bordeaux|nantes|strasbourg|montpellier|marseille|rennes|grenoble|nice|dijon|brest|limoges|poitiers|reims|angers|caen|rouen|amiens|besan[cç]on|clermont-ferrand|saint-[ée]tienne|nancy|n[iî]mes|la r[ée]union|pointe-[àa]-pitre|fort-de-france)\b/i;
// Faux positifs francophones hors de France (Québec, Belgique, Suisse, Maghreb…).
export const NOT_FR_RE = /\b(qu[ée]bec|montr[ée]al|sherbrooke|laval university|sainte-justine|li[èe]ge|bruxelles|brussels|louvain|gen[eè]ve|geneva|lausanne|belgi|suisse|switzerland|canada|luxembourg|tunis|maroc|morocco|alg[ée]r|dakar|beyrouth|beirut)/i;
