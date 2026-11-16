// Mise à jour hebdomadaire : collecte ClinicalTrials.gov → résumés en français (Claude) → data/.
// Usage : node scripts/update.mjs            collecte + reconstruction
//         OFFLINE=1 node scripts/update.mjs  reconstruction seule (après rédaction de fiches dans data/fr/)
//         OFFLINE=1 PUBS=1 node scripts/update.mjs  reconstruction + nouvelle vérification des publications sur PubMed
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
    // Articles déclarés « résultats » au registre (PMID) : simples candidats, vérifiés sur PubMed par verifyPubs.
    refs: (ps.referencesModule?.references ?? []).filter(r => r.type === "RESULT" && r.pmid).map(r => r.pmid), pubs: []
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
const key = s => /[34]/.test(s.phase) || s.hasResults ? 0 : 2;
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
}

// Publications : les références « RESULT » du registre sont souvent de la bibliographie de fond (autres études, revues).
// On ne garde donc que les articles PubMed qui citent le numéro NCT de l'étude (trouvés par recherche PubMed ou parmi les
// références du registre), plus les références du registre d'une étude terminée parues à partir de l'année de sa fin et sans autre numéro NCT.
// Type k : « r » résultats (article paru après la fin du critère principal), « p » protocole, « » autre article de l'étude ;
// ces deux derniers ne sont gardés que si PubMed rattache l'article à l'étude (numéro NCT indexé, pas seulement cité dans le résumé).
// Revues, méta-analyses, commentaires et éditoriaux sont écartés.
const EUT = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
async function eut(path, params, tries = 4) {
  for (let i = 0; ; i++) {
    await new Promise(res => setTimeout(res, 400));
    try {
      const r = await fetch(`${EUT}/${path}`, { method: "POST", body: new URLSearchParams({ db: "pubmed", tool: "studyprogress", ...params }) });
      if (r.ok) return r.text();
      if (i >= tries) throw new Error(`${r.status} ${path}`);
    } catch (e) { if (i >= tries) throw e; }
    await new Promise(res => setTimeout(res, 2000 * 2 ** i));
  }
}
const STOP = new Set("study trial patients with versus treatment efficacy safety evaluate evaluating phase randomized randomised controlled placebo double blind participants adults subjects clinical assess open label multicenter disease syndrome therapy effect effects compared using among from that this were have been after during their than between treated tolerability investigate".split(" "));
const MONTHS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const xtxt = t => (t ?? "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
function parseArticle(x) {
  x = x.replace(/<ReferenceList>[\s\S]*<\/ReferenceList>/, "");
  const tag = (t, src = x) => xtxt(src.match(new RegExp(`<${t}[ >][\\s\\S]*?</${t}>`))?.[0]);
  const date = b => { if (!b) return ""; const y = tag("Year", b) || tag("MedlineDate", b).slice(0, 4), m = tag("Month", b), d = tag("Day", b);
    const mm = MONTHS[m.slice(0, 3).toLowerCase()] ?? (m && m.padStart(2, "0")); return y + (mm ? "-" + mm + (d ? "-" + d.padStart(2, "0") : "") : ""); };
  const dates = [x.match(/<PubDate>[\s\S]*?<\/PubDate>/)?.[0], x.match(/<ArticleDate[\s\S]*?<\/ArticleDate>/)?.[0]].map(date).filter(Boolean).sort();
  const authors = [...x.matchAll(/<Author[ >][\s\S]*?<\/Author>/g)].map(a => tag("CollectiveName", a[0]) || `${tag("LastName", a[0])} ${tag("Initials", a[0])}`.trim()).filter(Boolean);
  const title = tag("ArticleTitle"), doi = x.match(/<ArticleId IdType="doi">([^<]+)</)?.[1] ?? "";
  const abs = [...x.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map(m => { const l = m[1].match(/Label="([^"]+)"/)?.[1]; return (l ? l + ": " : "") + xtxt(m[2]); }).join("\n");
  const types = [...x.matchAll(/<PublicationType[^>]*>([^<]+)</g)].map(m => m[1]);
  return {
    pmid: x.match(/<PMID[^>]*>(\d+)</)?.[1] ?? "", d: dates[0] ?? "", title, abs, types,
    si: new Set([...x.matchAll(/<AccessionNumber>\s*(NCT\d{8})/gi)].map(m => m[1].toUpperCase())),
    ncts: new Set((x.match(/NCT\d{8}/gi) ?? []).map(n => n.toUpperCase())),
    cit: `${authors.slice(0, 6).join(", ")}${authors.length > 6 ? ", et al" : ""}. ${title} ${tag("ISOAbbreviation")}. ${(dates[0] ?? "").slice(0, 4)}.${doi ? ` doi: ${doi}` : ""}`
  };
}
// Hors ligne : applique les décisions de data/pubs.json aux candidats de data/cand.json (article validé → publication de résultats).
async function applyDecisions(studies) {
  const dec = await readJSON("data/pubs.json", {}), cand = await readJSON("data/cand.json", []), byId = new Map(studies.map(s => [s.id, s]));
  for (const e of cand) {
    const s = byId.get(e.id), d = dec[e.id] ?? {};
    for (const a of e.c.filter(a => d.ok?.includes(a.pmid) && s && !s.pubs.some(p => p.pmid === a.pmid))) {
      s.pubs.unshift({ pmid: a.pmid, cit: a.cit, d: a.d, k: "r", t: 1 });
      s.abstracts = cut([`${a.cit}\n${a.abs}`, s.abstracts].filter(Boolean).join("\n\n"), 6000);
    }
    e.c = e.c.filter(a => !d.ok?.includes(a.pmid) && !d.no?.includes(a.pmid));
  }
  await writeFile("data/cand.json", JSON.stringify(cand.filter(e => e.c.length), null, 1) + "\n");
}
async function verifyPubs(studies) {
  const dec = await readJSON("data/pubs.json", {});
  const found = new Set([...studies.flatMap(s => s.refs ?? []), ...Object.values(dec).flatMap(d => d.ok ?? [])]);
  for (let i = 0; i < studies.length; i += 50) {
    const term = studies.slice(i, i + 50).map(s => `${s.id}[si] OR ${s.id}[tiab]`).join(" OR ");
    for (const id of JSON.parse(await eut("esearch.fcgi", { term, retmode: "json", retmax: "5000" })).esearchresult?.idlist ?? []) found.add(id);
  }
  const arts = new Map(), ids = [...found];
  for (let i = 0; i < ids.length; i += 150)
    for (const x of (await eut("efetch.fcgi", { id: ids.slice(i, i + 150).join(","), retmode: "xml" })).split(/(?=<PubmedArticle>)/).slice(1)) { const a = parseArticle(x); arts.set(a.pmid, a); }
  const byNct = new Map();
  for (const a of arts.values()) for (const n of a.ncts) byNct.set(n, [...(byNct.get(n) ?? []), a]);
  let n = 0;
  for (const s of studies) {
    const end = (s.pcd || s.end || "9999").slice(0, 7), done = /COMPLETED|TERMINATED/.test(s.status);
    const noise = a => a.ncts.size > 4 || a.types.some(t => /Erratum|Retract|Review|Meta-Analysis|Comment|Editorial/i.test(t));
    const kind = a => /\bprotocol\b|rationale|study design|design of|design and/i.test(a.title) ? "p"
      : a.d.slice(0, 7) >= end.slice(0, a.d.length) ? "r" : "";
    const cited = (byNct.get(s.id) ?? []).filter(a => !noise(a) && (kind(a) === "r" || a.si.has(s.id)));
    const declared = (s.refs ?? []).map(id => arts.get(id)).filter(a => a && done && !a.ncts.size && !noise(a) && a.d.slice(0, 4) >= end.slice(0, 4));
    s.pubs = [...new Map([...cited.map(a => [a, kind(a)]), ...declared.map(a => [a, "r"]), ...(dec[s.id]?.ok ?? []).map(id => [arts.get(id), "r", 1]).filter(e => e[0])]
      .map(([a, k, t]) => [a.pmid, { pmid: a.pmid, cit: a.cit, d: a.d, k, ...(t && { t }) }])).values()]
      .sort((a, b) => (b.k === "r") - (a.k === "r") || b.d.localeCompare(a.d)).slice(0, 12);
  }
  // Veille par le titre : pour une étude dont le critère principal est échu et sans article de résultats, on cherche sur PubMed
  // comme le ferait un lecteur (acronyme, sinon molécule dans le titre) un article paru depuis. Il n'est retenu que s'il reprend
  // l'essentiel des mots du titre de l'étude, la même phase, et ne cite aucun numéro NCT (sinon il appartient à une autre étude).
  // Ce rapprochement se trompe souvent : les articles sont seulement proposés dans data/cand.json. La tâche Claude hebdomadaire lit
  // le résumé et tranche dans data/pubs.json ({ "<NCT>": { "ok": ["pmid"], "no": ["pmid"] } }) ; un article « ok » devient une
  // publication de résultats (t: 1, « rapproché par le titre »), un article « no » n'est plus proposé.
  const words = t => new Set((t ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)));
  const late = studies.filter(s => s.pcd && s.pcd <= TODAY && !/^(RECRUITING|NOT_YET)/.test(s.status) && !s.pubs.some(p => p.k === "r"));
  const hits = new Map();
  for (const s of late) {
    const dp = ` AND ("${s.pcd.slice(0, 7).replace("-", "/")}"[dp] : "3000"[dp])`, drug = drugs(s)[0];
    const qs = [/^[A-Za-z][\w-]{3,}$/.test(s.acr) && `"${s.acr}"[tiab]`, drug && `"${drug}"[ti]`].filter(Boolean);
    const ids = new Set();
    for (const q of qs) try { for (const id of JSON.parse(await eut("esearch.fcgi", { term: q + dp, retmode: "json", retmax: "15", sort: "relevance" })).esearchresult?.idlist ?? []) ids.add(id); } catch {}
    hits.set(s.id, [...ids]);
  }
  const more = [...new Set([...hits.values()].flat())].filter(id => !arts.has(id));
  for (let i = 0; i < more.length; i += 150)
    for (const x of (await eut("efetch.fcgi", { id: more.slice(i, i + 150).join(","), retmode: "xml" })).split(/(?=<PubmedArticle>)/).slice(1)) { const a = parseArticle(x); arts.set(a.pmid, a); }
  let nt = 0; const cand = [];
  for (const s of late) {
    const T = [...words(`${s.title} ${s.off ?? ""}`)], ph = (s.phase.match(/\d/g) ?? []);
    const score = a => { const A = words(`${a.title} ${a.abs}`); return T.filter(w => A.has(w)).length / (T.length || 1); };
    const ok = a => a && a.abs && !a.ncts.size && a.d.slice(0, 7) >= s.pcd.slice(0, a.d.length).slice(0, 7)
      && !a.types.some(t => /Erratum|Retract|Review|Meta-Analysis|Comment|Editorial/i.test(t)) && !/\bprotocol\b|rationale|study design|design of|design and/i.test(a.title)
      && (ph.length ? ph : ["1", "2", "3", "4"]).some(p => !/phase\s*(\d|i+v?\b)/i.test(a.title + a.abs) || new RegExp(`phase\\s*(${p}|${["", "i", "ii", "iii", "iv"][p]})\\b`, "i").test(a.title + a.abs))
      && score(a) >= (s.acr && new RegExp(`\\b${s.acr}\\b`).test(a.title + " " + a.abs) ? 0.5 : 0.6);
    const c = hits.get(s.id).filter(id => !dec[s.id]?.no?.includes(id)).map(id => arts.get(id)).filter(ok).sort((a, b) => score(b) - score(a)).slice(0, 2);
    if (c.length) { nt += c.length; cand.push({ id: s.id, acr: s.acr, title: s.title, pcd: s.pcd, c: c.map(a => ({ pmid: a.pmid, cit: a.cit, d: a.d, abs: cut(a.abs, 2500) })) }); }
  }
  await writeFile("data/cand.json", JSON.stringify(cand, null, 1) + "\n");
  console.log(`Veille par le titre : ${nt} articles à valider (data/cand.json) pour ${late.length} études échues sans publication`);
  for (const s of studies) {
    const abs = s.pubs.filter(p => p.k === "r" && arts.get(p.pmid).abs).slice(0, 3).map(p => `${p.cit}\n${arts.get(p.pmid).abs}`).join("\n\n");
    if (abs) s.abstracts = cut(abs, 6000); else delete s.abstracts;
    n += s.pubs.length;
  }
  console.log(`Publications vérifiées sur PubMed : ${n} (sur ${ids.length} candidates)`);
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
    const withRes = studies.filter(s => s.hasResults);
    let i = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (i < withRes.length) { const s = withRes[i++]; try { await addResults(s); } catch (e) { console.warn(`Résultats ${s.id} : ${e.message}`); } }
    }));
    console.log(`Résultats détaillés : ${withRes.length} études`);
  }
  if (!process.env.OFFLINE || process.env.PUBS) await verifyPubs(studies); else await applyDecisions(studies);
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
    sites: s.sites, q: s.x?.question ?? "", p: s.x?.profil ?? "", seen: s.seen, chg: s.chg, res: s.hasResults || s.pubs.some(p => p.k === "r"),
    pub: s.pubs.length, rd: s.rdate || (s.pubs.find(p => p.k === "r")?.d ?? ""), rnd: s.alloc === "RANDOMIZED" ? 1 : 0, iv: drugs(s), v: [...new Set(s.frSites.map(l => city(l.c)).filter(Boolean))].sort()
  }));
  await writeFile("data/todo.json", JSON.stringify(todo.map(s => ({ id: s.id, h: s.h, acr: s.acr, fr: s.fr })), null, 0).replace(/},/g, "},\n"));
  await writeFile("data/studies.json", JSON.stringify({ updated: process.env.OFFLINE && prev.updated || TODAY, diseases: DISEASES.map(({ q, ...d }) => d), studies: light }));
  console.log(`${studies.length} études, dont ${studies.filter(s => s.fr === "promo").length} à promotion française ; ${studies.filter(s => s.x).length} résumées ; ${todo.length} fiches à rédiger (data/todo.json).`);
}

main().catch(e => { console.error(e); process.exit(1); });
