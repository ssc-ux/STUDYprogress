// Fiche explicative en français d'une étude, rédigée par Claude à partir du registre.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const Fiche = z.object({
  titre: z.string().describe("Titre court en français (moins de 110 caractères), sans l'acronyme"),
  question: z.string().describe("La question posée par l'étude, en une phrase"),
  contexte: z.string().describe("Contexte détaillé du projet, 6 à 9 phrases en un ou deux paragraphes séparés par une ligne vide"),
  interet: z.string().describe("Ce que l'étude pourrait changer en pratique, 2 à 4 phrases"),
  profil: z.string().describe("La population étudiée, en une phrase (« Des adultes… »)"),
  inclusion: z.array(z.string()).describe("4 à 7 critères d'inclusion clés, courts"),
  exclusion: z.array(z.string()).describe("4 à 7 critères d'exclusion clés, courts"),
  bras: z.array(z.object({ nom: z.string(), traitement: z.string() })).describe("Bras ou groupes de l'étude (1 à 4)"),
  duree: z.string().describe("Durée de participation ou de suivi par patient, ex. « 52 semaines »"),
  critere: z.string().describe("Critère de jugement principal reformulé simplement, avec son délai")
});

const SYSTEM = `Tu rédiges des fiches d'études cliniques pour des internistes français. Ils veulent s'informer en une minute : pourquoi l'étude existe, ce qu'elle teste, sur quelle population. Le site informe, il ne sert pas à orienter des patients.

Règles :
- Français médical clair, phrases courtes, sans jargon administratif. Noms de molécules en DCI, abréviations usuelles en médecine interne (GPA, PAM, ACG, PTI…).
- Contexte : décris la maladie et le besoin non couvert, ce que montrent les données ou recommandations actuelles, le rationnel de l'intervention (mécanisme, résultats préliminaires), et ce qu'apporte cette étude par rapport à l'existant (population, comparateur, design). Cite le promoteur ou le réseau quand c'est utile. Tu peux t'appuyer sur tes connaissances médicales générales pour situer le contexte, mais n'invente jamais de résultats de cette étude ni de données chiffrées absentes du registre.
- Critères : reprends les critères du registre, condensés ; ne rajoute aucun critère.
- Si une information manque dans le registre, écris « non précisé ».`;

const fmt = s => [
  `Identifiant : ${s.id}${s.acr ? ` (${s.acr})` : ""}`,
  `Titre : ${s.title}`, s.off && `Titre officiel : ${s.off}`,
  `Promoteur : ${s.sponsor}${s.collabs.length ? ` ; collaborateurs : ${s.collabs.join(", ")}` : ""}`,
  `Type : ${s.type} ${s.phase} ; allocation ${s.alloc || "?"} ; insu ${s.mask || "?"} ; ${s.n ?? "?"} patients (${s.nType})`,
  `Pathologies : ${s.conds.join(", ")}`,
  `Résumé : ${s.summary}`, s.desc && `Description : ${s.desc}`,
  `Bras : ${s.arms.map(a => `${a.l} [${a.t}] ${a.d} (${a.i.join(", ")})`).join(" | ")}`,
  `Critère principal : ${s.primary.map(o => `${o.m} (${o.tf})`).join(" | ")}`,
  `Éligibilité (sexe ${s.sex}, âge ${s.minAge || "?"} à ${s.maxAge || "?"}) :\n${s.elig}`
].filter(Boolean).join("\n");

let client;
export async function summarize(s) {
  client ??= new Anthropic();
  const r = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "medium", format: zodOutputFormat(Fiche) },
    messages: [{ role: "user", content: `Rédige la fiche de cette étude.\n\n${fmt(s)}` }]
  });
  if (r.stop_reason !== "end_turn") throw new Error(`arrêt ${r.stop_reason}`);
  return r.parsed_output;
}
