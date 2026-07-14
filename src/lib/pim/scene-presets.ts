/**
 * Scene preset library for product visualization generation.
 *
 * Each preset carries a Polish label + short description for the picker UI
 * and English `style_en` / `requirements_en` written in the same
 * photographic-language dialect as `buildFalPromptsFromPolish`:
 * camera angle, focal length + depth of field, light direction + colour
 * temperature, and an explicit product-preservation sentence.
 *
 * Presets are the *default* input to the FAL pipeline; per-product vision
 * personalisation is merged on top as additional requirements. Colour, logo
 * and label preservation meta-rules always take precedence over anything
 * defined here.
 */

export type ScenePreset = {
  id: string;
  label_pl: string;
  thumbnail_hint: string;
  style_en: string;
  requirements_en: string;
  /** True for custom presets loaded from projects.settings.scene_presets[]. */
  custom?: boolean;
};

const PRESERVE = [
  "Preserve product colour, logo, printed text, materials and proportions letter-for-letter;",
  "background/props change only, product itself stays identical to the reference.",
].join(" ");

export const BUILT_IN_PRESETS: ScenePreset[] = [
  {
    id: "studio_packshot",
    label_pl: "Studio packshot",
    thumbnail_hint: "Czyste białe tło #FFFFFF, delikatny cień kontaktowy, kadr 1:1.",
    style_en:
      "Seamless pure white studio background #FFFFFF, soft realistic contact shadow, clean e-commerce packshot.",
    requirements_en: [
      "Eye-level 3/4 view, 85mm equivalent, deep focus so the product is fully sharp edge-to-edge.",
      "Soft diffused overhead key light, neutral 5500K, minimal fill from the opposite side, no coloured gels.",
      "Product centred, longest edge ~75% of the canvas, no props competing with the product.",
      PRESERVE,
    ].join(" "),
  },
  {
    id: "lifestyle_kitchen",
    label_pl: "Lifestyle · kuchnia",
    thumbnail_hint: "Blat drewniany lub kamienny, poranne światło z okna, subtelne rekwizyty kuchenne.",
    style_en:
      "Modern Scandinavian kitchen scene, oak or light stone countertop, matte off-white cabinetry blurred in the background, morning window light.",
    requirements_en: [
      "Eye-level 3/4 view, 50mm, shallow depth of field so the background is softly blurred.",
      "Soft window light from the left, warm 4500K, gentle bounce fill on the right.",
      "1–2 believable kitchen props (fresh herbs, linen cloth, wooden board) placed asymmetrically, never covering the product.",
      PRESERVE,
    ].join(" "),
  },
  {
    id: "lifestyle_bathroom",
    label_pl: "Lifestyle · łazienka",
    thumbnail_hint: "Jasny marmur, mikro-krople wody, świeże ręczniki, spa-like nastrój.",
    style_en:
      "Bright modern bathroom vignette, honed white marble surface, matte chrome fixtures blurred behind, spa-like calm.",
    requirements_en: [
      "Low 3/4 hero angle, 50mm, shallow depth of field, background softly blurred.",
      "Cool daylight from a frosted window, neutral 5500K, subtle specular highlights on wet surfaces.",
      "Micro water droplets on the surface, folded white towel or eucalyptus sprig as a single supporting prop.",
      PRESERVE,
    ].join(" "),
  },
  {
    id: "lifestyle_livingroom",
    label_pl: "Lifestyle · salon",
    thumbnail_hint: "Ciepła tkanina, dębowy stolik, wieczorne światło, przytulny nastrój.",
    style_en:
      "Cosy contemporary living room, oak side table, textured linen or bouclé throw blurred behind, warm evening ambience.",
    requirements_en: [
      "Eye-level 3/4 view, 35mm, medium depth of field, background pleasantly out of focus.",
      "Warm lamp light from the left, 3200K, subtle window fill from the right for separation.",
      "1–2 discreet props (open hardcover book, ceramic mug, dried grass stem) staged around but never on the product.",
      PRESERVE,
    ].join(" "),
  },
  {
    id: "office_workshop",
    label_pl: "Biuro / warsztat",
    thumbnail_hint: "Blat roboczy, dokumenty lub narzędzia w tle, chłodne światło techniczne.",
    style_en:
      "Utilitarian workspace: matte grey worktop or workshop bench, tools/papers softly blurred behind, technical mood.",
    requirements_en: [
      "Top-down 30° angle, 50mm, deep focus so both the product and the immediate surface stay sharp.",
      "Cool overhead LED light, neutral 5500K, small hard fill from the front for surface texture.",
      "1–2 contextual work props (notebook, tape measure, spare part) arranged in a rule-of-thirds composition.",
      PRESERVE,
    ].join(" "),
  },
  {
    id: "outdoor_garden",
    label_pl: "Plener / ogród",
    thumbnail_hint: "Trawa, liście, drewniana ławka, złota godzina, naturalne światło.",
    style_en:
      "Outdoor garden setting, green foliage and rustic wood softly blurred, natural daylight, believable seasonal foliage.",
    requirements_en: [
      "Low 3/4 hero angle, 50mm, shallow depth of field so the greenery bokehs behind the product.",
      "Golden-hour sunlight from the back-left creating a warm rim, warm 4200K, soft frontal fill.",
      "Fresh leaves, soil or bark aligned with the product category; no fantasy elements, no visible people.",
      PRESERVE,
    ].join(" "),
  },
  {
    id: "flat_lay",
    label_pl: "Flat lay",
    thumbnail_hint: "Widok z góry, minimalistyczna kompozycja, matowe tło.",
    style_en:
      "Overhead flat lay on a matte neutral surface (paper, linen or fine plaster), minimalist editorial composition.",
    requirements_en: [
      "Top-down 90° view, 50mm, deep focus so every element is uniformly sharp.",
      "Soft diffused daylight from above-left, neutral 5500K, gentle side fill to lift shadows.",
      "1–3 supporting props sized smaller than the product, arranged with generous negative space around the hero.",
      PRESERVE,
    ].join(" "),
  },
  {
    id: "material_hero",
    label_pl: "Materiał hero (makro)",
    thumbnail_hint: "Zbliżenie na fakturę, mocne światło boczne, wydobyta tekstura.",
    style_en:
      "Close-up hero shot emphasising surface texture, material grain and craftsmanship, minimal contextual background.",
    requirements_en: [
      "Macro 3/4 angle at the product surface, 100mm macro, shallow depth of field to isolate the texture.",
      "Hard raking light from the side (~30° incidence), cool 5500K, tight controlled fill to preserve micro-detail.",
      "No props competing with the surface; keep the frame dominated by the product's material and finish.",
      PRESERVE,
    ].join(" "),
  },
  {
    id: "seasonal_neutral",
    label_pl: "Scena sezonowa (neutralna)",
    thumbnail_hint: "Delikatne akcenty sezonowe bez marek, uniwersalny, ciepły klimat.",
    style_en:
      "Neutral seasonal vignette (subtle greenery, natural fabric, kraft paper) without any brand or holiday-specific symbols.",
    requirements_en: [
      "Eye-level 3/4 view, 50mm, medium depth of field, background softly blurred but readable.",
      "Soft daylight from the left, warm 4500K, gentle bounce fill on the right for even exposure.",
      "1–2 timeless props (dried branch, natural twine, folded fabric) — no logos, no holiday iconography, no text overlays.",
      PRESERVE,
    ].join(" "),
  },
  {
    id: "retail_shelf",
    label_pl: "Półka sklepowa",
    thumbnail_hint: "Produkt na półce, subtelny kontekst detaliczny, ciepłe światło sklepu.",
    style_en:
      "Product on a clean retail shelf, matte white or light oak shelving, hint of a store aisle softly blurred behind.",
    requirements_en: [
      "Eye-level straight-on view, 50mm, shallow depth of field so the store context bokehs behind.",
      "Warm ceiling spotlight from above, 3800K, gentle frontal fill to keep labels readable.",
      "No competing branded products; keep neighbouring space empty or filled with plain neutral packaging out of focus.",
      PRESERVE,
    ].join(" "),
  },
];

/** Sentinel id used to represent legacy free-text project settings. */
export const LEGACY_PRESET_ID = "__legacy_custom__";

export function legacyPreset(
  style: string | null | undefined,
  requirements: string | null | undefined,
): ScenePreset | null {
  const s = (style ?? "").trim();
  const r = (requirements ?? "").trim();
  if (!s && !r) return null;
  return {
    id: LEGACY_PRESET_ID,
    label_pl: "Dotychczasowe ustawienia",
    thumbnail_hint: "Zapisane wcześniej pola stylu i wymagań.",
    // Legacy content is Polish free text; treat it as-is on both sides so the
    // existing FAL pipeline (which accepts PL requirements and EN style) keeps
    // producing the same output as before this refactor.
    style_en: s,
    requirements_en: r,
    custom: true,
  };
}

/** Read custom presets stored on projects.settings.scene_presets. */
export function readCustomPresets(settings: unknown): ScenePreset[] {
  const arr = (settings as { scene_presets?: unknown } | null | undefined)?.scene_presets;
  if (!Array.isArray(arr)) return [];
  const out: ScenePreset[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const label = typeof r.label_pl === "string" ? r.label_pl : "";
    const style = typeof r.style_en === "string" ? r.style_en : "";
    const requirements = typeof r.requirements_en === "string" ? r.requirements_en : "";
    if (!id || !label) continue;
    out.push({
      id,
      label_pl: label,
      thumbnail_hint: typeof r.thumbnail_hint === "string" ? r.thumbnail_hint : "Własny preset projektu.",
      style_en: style,
      requirements_en: requirements,
      custom: true,
    });
  }
  return out;
}

export function resolvePresetById(
  id: string,
  customPresets: ScenePreset[],
): ScenePreset | null {
  return (
    BUILT_IN_PRESETS.find((p) => p.id === id) ??
    customPresets.find((p) => p.id === id) ??
    null
  );
}

/**
 * Compose the final `stylePrompt` / `requirementsPl` payload for the FAL
 * pipeline from a preset + optional per-product adjustments. The preset text
 * comes first so `buildFalPromptsFromPolish` treats it as authoritative and
 * merges the adjustments as overrides / additions.
 *
 * When `adjustments` is provided, it is appended after the preset content in
 * Polish (as the FAL pipeline explicitly instructs the model that Polish
 * requirements override defaults while never overriding preservation rules).
 */
export function composePresetPayload(
  preset: ScenePreset,
  adjustments?: string | null,
): { stylePrompt: string; requirementsPl: string } {
  const adj = (adjustments ?? "").trim();
  const style = preset.style_en.trim();
  const requirements = adj
    ? `${preset.requirements_en.trim()}\n\nDodatkowe wskazówki dla tego produktu (PL, mają pierwszeństwo poza zasadami zachowania produktu): ${adj}`
    : preset.requirements_en.trim();
  return { stylePrompt: style, requirementsPl: requirements };
}