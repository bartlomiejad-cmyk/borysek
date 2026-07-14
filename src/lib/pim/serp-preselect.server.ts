/**
 * AI pre-selection of Google SERP results before Firecrawl scraping.
 *
 * Server-only. Used only in the Apify search path so the model budgets
 * stay tight for existing Firecrawl-based projects.
 */

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash-lite";

export type PreselectInput = {
  product: {
    nazwa: string | null;
    ean?: string | null;
    producent?: string | null;
    kod_producenta?: string | null;
  };
  items: Array<{ i: number; title: string; snippet: string; domain: string }>;
};

export type PreselectPick = { i: number; why: string };

export type PreselectResult = {
  ok: boolean;
  picks: PreselectPick[];
  error?: string;
};

const SYSTEM_PROMPT =
  'Wybierz wyniki wyszukiwania, które najprawdopodobniej prowadzą do strony produktowej opisującej DOKŁADNIE ten produkt. ' +
  "Priorytety: (1) EAN lub kod producenta widoczny w tytule/snippecie, (2) strona producenta, (3) tytuł zawiera markę+model+wariant. " +
  "Odrzuć: listingi kategorii, blogi/poradniki, agregatory, inne warianty. " +
  'Zwróć JSON {"picks": [{"i": number, "why": string(krótko)}]} — maksymalnie 12 pozycji, posortowane od najlepszej.';

export async function preselectSerpResults(input: PreselectInput): Promise<PreselectResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { ok: false, picks: [], error: "Brak LOVABLE_API_KEY" };

  const capped = input.items.slice(0, 40);
  if (!capped.length) return { ok: true, picks: [] };

  const productBlock = [
    `Nazwa: ${input.product.nazwa ?? "-"}`,
    input.product.ean ? `EAN: ${input.product.ean}` : "",
    input.product.producent ? `Producent: ${input.product.producent}` : "",
    input.product.kod_producenta ? `Kod producenta: ${input.product.kod_producenta}` : "",
  ].filter(Boolean).join("\n");

  const itemsBlock = capped
    .map((it) => `${it.i}. [${it.domain}] ${it.title}\n   ${it.snippet}`)
    .join("\n");

  const user = `PRODUKT:\n${productBlock}\n\nWYNIKI (indeks. [domena] tytuł / snippet):\n${itemsBlock}`;

  try {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      return { ok: false, picks: [], error: `gateway ${res.status}` };
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { picks?: unknown };
    const validIdx = new Set(capped.map((c) => c.i));
    const picks: PreselectPick[] = Array.isArray(parsed.picks)
      ? (parsed.picks as unknown[])
          .map((p) => {
            if (!p || typeof p !== "object") return null;
            const o = p as { i?: unknown; why?: unknown };
            const i = typeof o.i === "number" ? o.i : Number(o.i);
            if (!Number.isFinite(i) || !validIdx.has(i)) return null;
            const why = typeof o.why === "string" ? o.why.slice(0, 200) : "";
            return { i, why };
          })
          .filter((v): v is PreselectPick => v !== null)
          .slice(0, 12)
      : [];
    return { ok: true, picks };
  } catch (e) {
    return { ok: false, picks: [], error: e instanceof Error ? e.message : String(e) };
  }
}