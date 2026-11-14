// Mise à jour hebdomadaire : collecte ClinicalTrials.gov → résumés en français (Claude) → data/.
// Usage : node scripts/update.mjs            collecte + reconstruction
//         OFFLINE=1 node scripts/update.mjs  reconstruction seule (après rédaction de fiches dans data/fr/)
// Les fiches manquantes sont listées par priorité dans data/todo.json. Elles sont rédigées par la tâche
// Claude hebdomadaire, ou par l'API si ANTHROPIC_API_KEY est défini (npm install requis).
import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DISEASES, FR_RE, NOT_FR_RE } from "./conditions.mjs";

const API = "https://clinicaltrials.gov/api/v2/studies";
const TODAY = new Date().toISOString().slice(0, 10);
const ACTIVE = "NOT_YET_RECRUITING,RECRUITING,ENROLLING_BY_INVITATION,ACTIVE_NOT_RECRUITING";
// Études terminées gardées 2 ans pour suivre « où elles en sont » (résultats attendus ou publiés).
const SINCE = new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10);
const MAX_SUMMARIES = +(process.env.MAX_SUMMARIES ?? 400);

const readJSON = async (f, d) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return d; } };

async function get(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
      if (i >= tries || r.status < 500 && r.status !== 429) throw new Error(`${r.status} ${url}`);
    } catch (e) { if (i >= tries) throw e; }
    await new Promise(res => setTimeout(res, 2000 * 2 ** i));
  }
}

async function search(q, status, advanced) {
  const out = [];
  let token = "";
  do {
    const p = new URLSearchParams({ "query.cond": q, "filter.overallStatus": status, pageSize: "200", fields: "protocolSection,hasResults" });
    if (advanced) p.set("filter.advanced", advanced);
    if (token) p.set("pageToken", token);
    const j = await get(`${API}?${p}`);
    out.push(...(j.studies ?? []));
    token = j.nextPageToken;
  } while (token);
  return out;
}

const d = s => s?.date ?? "";
const PHASE = { EARLY_PHASE1: "Phase 1", PHASE1: "Phase 1", PHASE2: "Phase 2", PHASE3: "Phase 3", PHASE4: "Phase 4" };

function normalize(st) {
  const ps = st.protocolSection, id = ps.identificationModule, s = ps.statusModule, sp = ps.sponsorCollaboratorsModule ?? {};
  const ds = ps.designModule ?? {}, el = ps.eligibilityModule ?? {}, cl = ps.contactsLocationsModule ?? {}, ai = ps.armsInterventionsModule ?? {};
  const locs = cl.locations ?? [];
  const officials = (cl.overallOfficials ?? []).map(o => ({ n: o.name, a: o.affiliation, r: o.role }));
  const frSites = locs.filter(l => l.country === "France").map(l => ({ f: l.facility, c: l.city, s: l.status }));
  const who = [sp.leadSponsor?.name, ...officials.map(o => o.a)].filter(Boolean).join(" | ");
  const promo = FR_RE.test(who) && !NOT_FR_RE.test(who) && (frSites.length > 0 || locs.length === 0);
  const phases = [...new Set((ds.phases ?? []).map(p => PHASE[p]).filter(Boolean))];
  return {
    id: id.nctId, acr: id.acronym ?? "", title: id.briefTitle, off: id.officialTitle ?? "",
    status: s.overallStatus, type: ds.studyType, phase: phases.join("/"),
    alloc: ds.designInfo?.allocation ?? "", mask: ds.designInfo?.maskingInfo?.masking ?? "", model: ds.designInfo?.interventionModel ?? ds.designInfo?.observationalModel ?? "",
    n: ds.enrollmentInfo?.count ?? null, nType: ds.enrollmentInfo?.type ?? "",
    start: d(s.startDateStruct), pcd: d(s.primaryCompletionDateStruct), end: d(s.completionDateStruct),
    first: d(s.studyFirstPostDateStruct), upd: d(s.lastUpdatePostDateStruct), rdate: d(s.resultsFirstPostDateStruct),
    sponsor: sp.leadSponsor?.name ?? "", sClass: sp.leadSponsor?.class ?? "", collabs: (sp.collaborators ?? []).map(c => c.name),
    fr: promo ? "promo" : frSites.length ? "centres" : "", frSites, sites: locs.length,
    countries: new Set(locs.map(l => l.country)).size, officials,
    conds: ps.conditionsModule?.conditions ?? [],
    summary: ps.descriptionModule?.briefSummary ?? "", desc: (ps.descriptionModule?.detailedDescription ?? "").slice(0, 6000),
    elig: el.eligibilityCriteria ?? "", sex: el.sex ?? "", minAge: el.minimumAge ?? "", maxAge: el.maximumAge ?? "",
    arms: (ai.armGroups ?? []).map(a => ({ l: a.label, t: a.type ?? "", d: a.description ?? "", i: a.interventionNames ?? [] })),
    interventions: (ai.interventions ?? []).map(i => ({ t: i.type, n: i.name })),
    primary: (ps.outcomesModule?.primaryOutcomes ?? []).map(o => ({ m: o.measure, tf: o.timeFrame ?? "" })),
    hasResults: !!st.hasResults,
    pubs: (ps.referencesModule?.references ?? []).filter(r => r.type === "RESULT").map(r => ({ pmid: r.pmid ?? "", cit: r.citation }))
  };
}

// Villes françaises : nom nettoyé, communes hospitalières rattachées à leur CHU (filtre « ma ville » du site).
const AGGLO = { "Créteil": "Paris", "Le Kremlin-Bicêtre": "Paris", "Bobigny": "Paris", "Suresnes": "Paris", "Bondy": "Paris", "Boulogne-Billancourt": "Paris", "Villejuif": "Paris", "Clichy": "Paris", "Garches": "Paris", "Montreuil": "Paris", "Antony": "Paris", "Issy-les-Moulineaux": "Paris", "Ivry-sur-Seine": "Paris", "Limeil-Brévannes": "Paris", "Charenton-le-Pont": "Paris", "Montfermeil": "Paris", "Pessac": "Bordeaux", "Talence": "Bordeaux", "Bron": "Lyon", "Pierre-Bénite": "Lyon", "Villeurbanne": "Lyon", "Caluire-et-Cuire": "Lyon", "Oullins": "Lyon", "Vandœuvre-lès-Nancy": "Nancy", "La Tronche": "Grenoble", "Saint-Priest-en-Jarez": "Saint-Étienne", "Chambray-lès-Tours": "Tours", "Saint-Herblain": "Nantes", "Bois-Guillaume": "Rouen", "Salouël": "Amiens", "Lomme": "Lille", "Cesson-Sévigné": "Rennes", "Trélazé": "Angers" };
const FIX = { "Saint-Etienne": "Saint-Étienne", "Le Kremlin-Bictre": "Le Kremlin-Bicêtre", "Saint Priest En Jarez": "Saint-Priest-en-Jarez", "St-Malo": "Saint-Malo", "Nice Alpes": "Nice", "FORT de France": "Fort-de-France" };
const city = c => {
  c = (c ?? "").replace(/\s+c[ée]dex.*$/i, "").trim(); c = FIX[c] ?? c;
  return !c || /c[ée]dex|many|finist|bouches|seine-maritime|martinique/i.test(c) ? "" : AGGLO[c] ?? c;
};
// Molécules testées (médicaments et biothérapies), sans placebo ni soins courants : vue « pipeline » par maladie.
const cleanDrug = n => { n = n.replace(/\s*\(.*?\)/g, "").replace(/\b(administration|injection|infusion|tablets?|capsules?|oral|intravenous|subcutaneous)\b/gi, "").replace(/\b\d+([.,]\d+)?\s*(mg|g|ml|mcg|µg|ui|iu)\b.*$/i, "").replace(/\s+/g, " ").trim(); return n && n[0].toUpperCase() + n.slice(1); };
const drugs = s => [...new Map(s.interventions.filter(i => /DRUG|BIOLOGICAL|GENETIC|COMBINATION/.test(i.t)).map(i => cleanDrug(i.n))
  .filter(n => n.length >= 3 && n.length <= 40 && !/placebo|standard of care|\bsoc\b|saline|vehicle|sampl|sham|usual care/i.test(n)).map(n => [n.toLowerCase(), n])).values()].slice(0, 3);

// Ordre de priorité des fiches : nouvelles études françaises (page d'accueil), autres françaises, centres en France, puis le reste.
const OPEN = /RECRUIT|ENROLLING/;
// À classe égale : phase 3-4 ou résultats disponibles d'abord (ce qui change la pratique), ouvertes avant terminées.
const key = s => /[34]/.test(s.phase) || s.hasResults || s.pubs.length ? 0 : 2;
const prio = s => s.fr === "promo" && OPEN.test(s.status) && s.start >= SINCE.replace(/^\d{4}/, y => +y + 1) ? 0
  : (s.fr === "promo" ? 1 : s.fr ? 2 : 3) * 4 + key(s) + (OPEN.test(s.status) ? 0 : 1);
// Résultats détaillés : critères principaux et tolérance déposés au registre, résumés PubMed des publications de résultats.
const cut = (t, n) => (t ?? "").length > n ? t.slice(0, n) + "…" : t ?? "";
async function addResults(s) {
  if (s.hasResults) {
    const r = (await get(`${API}/${s.id}?fields=resultsSection`)).resultsSection ?? {};
    s.results = {
      primary: (r.outcomeMeasuresModule?.outcomeMeasures ?? []).filter(o => o.type === "PRIMARY").slice(0, 3).map(o => ({
        t: o.title, tf: o.timeFrame ?? "", u: o.unitOfMeasure ?? "", p: o.paramType ?? "", d: o.dispersionType ?? "",
        g: (o.groups ?? []).map(g => ({ id: g.id, t: g.title })), n: o.denoms?.[0]?.counts ?? [],
        m: (o.classes ?? []).slice(0, 4).flatMap(c => (c.categories ?? []).slice(0, 4).map(k => ({ c: [c.title, k.title].filter(Boolean).join(" · "),
          v: (k.measurements ?? []).map(x => ({ g: x.groupId, v: x.value, s: x.spread ?? "", l: x.lowerLimit ?? "", h: x.upperLimit ?? "" })) }))),
        a: (o.analyses ?? []).slice(0, 3).map(a => ({ pv: a.pValue ?? "", m: a.statisticalMethod ?? "", pt: a.paramType ?? "", v: a.paramValue ?? "", lo: a.ciLowerLimit ?? "", hi: a.ciUpperLimit ?? "", ci: a.ciPctValue ?? "" }))
      })),
      ae: (r.adverseEventsModule?.eventGroups ?? []).map(g => ({ t: g.title, ser: g.seriousNumAffected, die: g.deathsNumAffected, n: g.seriousNumAtRisk }))
    };
  }
  const ids = s.pubs.map(p => p.pmid).filter(Boolean).slice(0, 3);
  if (ids.length) {
    const r = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&rettype=abstract&retmode=text`);
    if (r.ok) s.abstracts = cut((await r.text()).trim(), 6000);
  }
}
const hashOf = s => createHash("sha1").update(JSON.stringify([s.title, s.summary, s.elig, s.arms, s.primary])).digest("hex").slice(0, 12);

async function main() {
  const prev = await readJSON("data/studies.json", { studies: [] });
  const prevById = new Map(prev.studies.map(s => [s.id, s]));
  const byId = new Map();
  if (process.env.OFFLINE) for (const f of await readdir("data/s")) { const s = await readJSON(`data/s/${f}`); byId.set(s.id, s); }
  else for (const dz of DISEASES) {
    const found = [...await search(dz.q, ACTIVE), ...await search(dz.q, "COMPLETED,TERMINATED", `AREA[PrimaryCompletionDate]RANGE[${SINCE},MAX]`)];
    for (const st of found) {
      const n = byId.get(st.protocolSection.identificationModule.nctId) ?? normalize(st);
      n.dis = [...new Set([...(n.dis ?? []), dz.id])];
      byId.set(n.id, n);
    }
    console.log(`${dz.fr} : ${found.length}`);
  }
  if (byId.size < 200) throw new Error(`Seulement ${byId.size} études : collecte probablement incomplète, rien n'est écrit.`);

  // Fiches en français : réutilise le cache ; une fiche est à (re)faire si l'étude est nouvelle ou son texte a changé.
  await mkdir("data/fr", { recursive: true });
  const studies = [...byId.values()];
  if (!process.env.OFFLINE) {
    const withRes = studies.filter(s => s.hasResults || s.pubs.some(p => p.pmid));
    let i = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (i < withRes.length) { const s = withRes[i++]; try { await addResults(s); } catch (e) { console.warn(`Résultats ${s.id} : ${e.message}`); } }
    }));
    console.log(`Résultats détaillés : ${withRes.length} études`);
  }
  const todo = [];
  for (const s of studies) {
    delete s.x;
    s.h = hashOf(s) + (s.results || s.abstracts ? "r" : ""); // « r » : la fiche est refaite quand des résultats paraissent.
    const c = await readJSON(`data/fr/${s.id}.json`, null);
    if (c) s.x = c;
    if (c?.h !== s.h) todo.push(s);
  }
  todo.sort((a, b) => prio(a) - prio(b));
  if (process.env.ANTHROPIC_API_KEY && todo.length) {
    const batch = todo.slice(0, MAX_SUMMARIES);
    const { summarize } = await import("./summarize.mjs");
    console.log(`Résumés à générer : ${batch.length} / ${todo.length}`);
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < batch.length) {
        const s = batch[i++];
        try {
          const x = await summarize(s);
          if (x) { todo.splice(todo.indexOf(s), 1); s.x = { h: s.h, date: TODAY, ...x }; await writeFile(`data/fr/${s.id}.json`, JSON.stringify(s.x, null, 1)); }
        } catch (e) { console.warn(`Résumé ${s.id} : ${e.message}`); }
      }
    }));
  }

  // Suivi des changements : date d'apparition et date du dernier changement de statut.
  for (const s of studies) {
    const p = prevById.get(s.id);
    s.seen = p?.seen ?? (prev.studies.length ? TODAY : s.first);
    s.chg = p && p.status !== s.status ? TODAY : p?.chg ?? "";
  }

  // Fiches détaillées (une par étude) + index léger pour la liste.
  await mkdir("data/s", { recursive: true });
  const keep = new Set(studies.map(s => `${s.id}.json`));
  for (const f of await readdir("data/s")) if (!keep.has(f)) await unlink(`data/s/${f}`);
  for (const s of studies) { const { h, ...rest } = s; await writeFile(`data/s/${s.id}.json`, JSON.stringify(rest)); }
  const light = studies.map(s => ({
    id: s.id, acr: s.acr, t: s.x?.titre || s.title, dis: s.dis, status: s.status, type: s.type, phase: s.phase,
    n: s.n, start: s.start, pcd: s.pcd, sponsor: s.sponsor, sClass: s.sClass, fr: s.fr, frN: s.frSites.length,
    sites: s.sites, q: s.x?.question ?? "", p: s.x?.profil ?? "", seen: s.seen, chg: s.chg, res: s.hasResults || s.pubs.length > 0,
    pub: s.pubs.length, rd: s.rdate || (s.pubs.length ? s.upd : ""), rnd: s.alloc === "RANDOMIZED" ? 1 : 0, iv: drugs(s), v: [...new Set(s.frSites.map(l => city(l.c)).filter(Boolean))].sort()
  }));
  await writeFile("data/todo.json", JSON.stringify(todo.map(s => ({ id: s.id, h: s.h, acr: s.acr, fr: s.fr })), null, 0).replace(/},/g, "},\n"));
  await writeFile("data/studies.json", JSON.stringify({ updated: process.env.OFFLINE && prev.updated || TODAY, diseases: DISEASES.map(({ q, ...d }) => d), studies: light }));
  console.log(`${studies.length} études, dont ${studies.filter(s => s.fr === "promo").length} à promotion française ; ${studies.filter(s => s.x).length} résumées ; ${todo.length} fiches à rédiger (data/todo.json).`);
}

main().catch(e => { console.error(e); process.exit(1); });
