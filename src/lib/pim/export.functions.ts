import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pickImages, pickThumbsForList, type ImageMeta, type ImageScores } from "./images";
import { getVisibleGallery, type GalleryImageScore } from "./gallery";
import { sanitizeAllegroHtml } from "./seo";
import { PIPELINE_STATUS_LABEL, type PimPipelineStatus } from "./pipeline-status";

type AuditPayload = {
  verdict?: "pass" | "warn" | "fail" | null;
  llm?: {
    factual_issues?: string[] | null;
    guideline_violations?: string[] | null;
  } | null;
} | null;

export const exportProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        approvedOnly: z.boolean().optional(),
        mode: z.enum(["client", "qc", "delivery"]).optional(),
        hostImages: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const mode = data.mode ?? "client";
    const hostImages = mode === "delivery" && (data.hostImages ?? true);

    const { data: project } = await supabase
      .from("projects")
      .select("include_extra_images")
      .eq("id", data.projectId)
      .single();
    const includeExtra = (project as { include_extra_images?: boolean } | null)?.include_extra_images ?? false;

    let prodQ = supabase
      .from("source_products")
      .select("id, ext_id, nazwa, kod, ean, review_status, pipeline_status, approved_at, manual_lock")
      .eq("project_id", data.projectId)
      ;
    if (data.approvedOnly) prodQ = prodQ.eq("review_status", "APPROVED");
    const { data: products, error } = await prodQ
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: ens } = await supabase
      .from("enrichments")
      .select(
        "source_product_id, status, match_type, matched_term, picked_urls, golden_name, golden_description, golden_features, golden_slug, golden_meta_description, golden_seo_keywords, hidden_images, image_meta, image_scores, regenerated_main_image, ai_gallery_urls, pinned_main_url, model, generated_at, allegro_description, allegro_generated_at, audit, data_sufficiency, score_breakdown",
      )
      .eq("project_id", data.projectId)
      .limit(100000);

    const imgMap = new Map<string, string[]>();
    const PAGE = 1000;
    const allSrcs: Array<{ url: string; images: unknown; extra_images?: unknown }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: srcErr } = await supabase
        .from("product_sources")
        .select("url, images, extra_images")
        .eq("project_id", data.projectId)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (srcErr) { console.error("product_sources fetch failed:", srcErr.message); break; }
      if (!page || page.length === 0) break;
      allSrcs.push(...page);
      if (page.length < PAGE) break;
    }
    for (const s of allSrcs) {
      const main = Array.isArray(s.images) ? (s.images as string[]) : [];
      const extra = includeExtra && Array.isArray((s as { extra_images?: unknown }).extra_images)
        ? ((s as { extra_images: string[] }).extra_images)
        : [];
      imgMap.set(s.url, [...main, ...extra]);
    }

    const map = new Map((ens ?? []).map((e) => [e.source_product_id, e]));

    // --- Durable image hosting (delivery mode) --------------------------
    const HOSTED_BUCKET = "regenerated-images";
    const MAX_BYTES = 8 * 1024 * 1024;
    const isHostedUrl = (u: string) =>
      /\/storage\/v1\/object\/public\//i.test(u) || u.includes(HOSTED_BUCKET);
    const extFromContentType = (ct: string): string => {
      const c = ct.toLowerCase();
      if (c.includes("png")) return "png";
      if (c.includes("webp")) return "webp";
      if (c.includes("gif")) return "gif";
      if (c.includes("avif")) return "avif";
      return "jpg";
    };
    async function sha1Hex(input: string): Promise<string> {
      const bytes = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest("SHA-1", bytes);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const admin = hostImages
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : null;
    async function hostOne(url: string, projectId: string, productId: string): Promise<string | null> {
      if (!admin) return url;
      if (isHostedUrl(url)) return url;
      try {
        const res = await fetch(url, {
          redirect: "follow",
          headers: {
            Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (compatible; LovableProductImageBot/1.0)",
          },
        });
        if (!res.ok) { console.warn(`[export.host] skip ${url} status=${res.status}`); return null; }
        const ct = res.headers.get("content-type") ?? "image/jpeg";
        if (!ct.startsWith("image/")) { console.warn(`[export.host] skip ${url} non-image ct=${ct}`); return null; }
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_BYTES) { console.warn(`[export.host] skip ${url} size=${buf.byteLength}`); return null; }
        const ext = extFromContentType(ct);
        const hash = (await sha1Hex(url)).slice(0, 20);
        const path = `exports/${projectId}/${productId}/${hash}.${ext}`;
        const { error: upErr } = await admin.storage
          .from(HOSTED_BUCKET)
          .upload(path, new Uint8Array(buf), { contentType: ct, upsert: true });
        if (upErr) { console.warn(`[export.host] upload failed ${url}: ${upErr.message}`); return null; }
        const { data: pub } = admin.storage.from(HOSTED_BUCKET).getPublicUrl(path);
        return pub.publicUrl;
      } catch (err) {
        console.warn(`[export.host] fetch failed ${url}:`, (err as Error).message);
        return null;
      }
    }

    // Pass 1: zbierz unikalny zbiór kluczy cech w całym projekcie (stabilna kolejność kolumn).
    const normalizeKey = (k: string) =>
      k.trim().replace(/[\s;]+/g, "_").replace(/_{2,}/g, "_");
    const allFeatureKeys = new Set<string>();
    for (const e of ens ?? []) {
      const feats = ((e as unknown as { golden_features?: Array<{ key: string; value: string }> }).golden_features) ?? [];
      for (const f of feats) {
        const k = normalizeKey(f.key ?? "");
        if (k) allFeatureKeys.add(k);
      }
    }
    const sortedFeatureKeys = [...allFeatureKeys].sort((a, b) => a.localeCompare(b, "pl"));

    // Max długość galerii AI w projekcie — wyznacza ile kolumn ai_gallery_*.
    let maxGallery = 0;
    for (const e of ens ?? []) {
      const g = ((e as unknown as { ai_gallery_urls?: string[] }).ai_gallery_urls) ?? [];
      if (Array.isArray(g) && g.length > maxGallery) maxGallery = g.length;
    }

    const rows: Array<Record<string, unknown>> = [];
    for (const p of products ?? []) {
      const e = map.get(p.id);
      const urls = (e?.picked_urls as string[] | undefined) ?? [];
      const hidden = new Set(((e as { hidden_images?: string[] } | undefined)?.hidden_images ?? []) as string[]);
      const meta = ((e as unknown as { image_meta?: ImageMeta } | undefined)?.image_meta ?? {}) as ImageMeta;
      const scores = ((e as unknown as { image_scores?: ImageScores } | undefined)?.image_scores ?? {}) as ImageScores;
      const identityScores = ((e as unknown as { image_scores?: Record<string, GalleryImageScore> } | undefined)?.image_scores ?? {}) as Record<string, GalleryImageScore>;
      const pinned = ((e as { pinned_main_url?: string | null } | undefined)?.pinned_main_url ?? null) as string | null;
      const all: string[] = [];
      for (const u of urls) {
        for (const img of imgMap.get(u) ?? []) {
          if (!all.includes(img)) all.push(img);
        }
      }
      // Only export images the AI accepted (identity=same or unscored,
      // banners/rejected/unsure filtered) so clients never receive verdicts
      // marked as belonging to a different product.
      const { accepted } = getVisibleGallery(all, {
        hidden_images: Array.from(hidden),
        image_scores: identityScores,
        pinned_main_url: pinned,
      });
      // Scrapowane zdjęcia ze źródeł — bez wymuszania regen. URL AI ma własną kolumnę.
      const images = pickImages(accepted, meta, hidden, scores);
      // Te same URL-e i kolejność co widok listy produktów (pinned > >=600 > reszta).
      const listImages = pickThumbsForList(accepted, meta, hidden, pinned, 12);
      const regen = ((e as { regenerated_main_image?: string | null } | undefined)?.regenerated_main_image) ?? "";
      // Allegro main image MUST come from the regen pipeline (pinned or FAL
      // white-background regen) — never from ai_gallery_urls, which contains
      // prop-styled visualizations that Allegro disallows as the main photo.
      const regenClean = regen && regen !== "__imported__" ? regen : "";
      const pinnedForAllegro = ((e as { pinned_main_url?: string | null } | undefined)?.pinned_main_url ?? "") as string;
      const allegroMainImage = regenClean || pinnedForAllegro;
      const gallery = (((e as unknown as { ai_gallery_urls?: string[] } | undefined)?.ai_gallery_urls) ?? []) as string[];
      const features = ((e as unknown as { golden_features?: Array<{ key: string; value: string }> } | undefined)?.golden_features ?? []);
      const featureCols: Record<string, string> = {};
      for (const k of sortedFeatureKeys) featureCols[`cecha_${k}`] = "";
      for (const f of features) {
        const k = normalizeKey(f.key ?? "");
        if (k) featureCols[`cecha_${k}`] = f.value ?? "";
      }
      const galleryCols: Record<string, string> = {};
      for (let i = 0; i < maxGallery; i++) galleryCols[`ai_gallery_${i + 1}`] = gallery[i] ?? "";

      // --- Delivery mode: minimal rows, hosted image URLs -------------
      if (mode === "delivery") {
        const galleryUrls = accepted.filter((u) => !identityScores[u]?.dead);
        let hostedGallery: string[] = galleryUrls;
        if (hostImages && admin) {
          const metaHosted = (meta as { hosted_urls?: Record<string, string> } | undefined)?.hosted_urls ?? {};
          const cache: Record<string, string> = { ...metaHosted };
          const out: string[] = [];
          let dirty = false;
          for (const u of galleryUrls) {
            if (isHostedUrl(u)) { out.push(u); continue; }
            const cached = cache[u];
            if (cached) { out.push(cached); continue; }
            const hosted = await hostOne(u, data.projectId, p.id);
            if (hosted) {
              cache[u] = hosted;
              dirty = true;
              out.push(hosted);
            }
          }
          hostedGallery = out;
          if (dirty && e) {
            const nextMeta = { ...(meta as Record<string, unknown>), hosted_urls: cache };
            await supabase
              .from("enrichments")
              .update({ image_meta: nextMeta } as never)
              .eq("source_product_id", p.id);
          }
        }
        const idCols: Record<string, string> = {};
        if (p.ext_id) idCols.id = p.ext_id;
        if (p.kod) idCols.kod = p.kod;
        if (p.ean) idCols.ean = p.ean;
        idCols.product_id = p.id;
        const thumb = regenClean;
        const visuals = gallery;
        rows.push({
          ...idCols,
          golden_name: e?.golden_name ?? "",
          golden_slug: ((e as { golden_slug?: string | null } | undefined)?.golden_slug) ?? "",
          golden_meta_description: ((e as { golden_meta_description?: string | null } | undefined)?.golden_meta_description) ?? "",
          golden_description: e?.golden_description ?? "",
          cechy: features.map((f) => `${f.key}: ${f.value}`).join(" | "),
          slowa_kluczowe: (((e as { golden_seo_keywords?: string[] | null } | undefined)?.golden_seo_keywords) ?? []).join(" | "),
          opis_allegro: sanitizeAllegroHtml(
            ((e as { allegro_description?: string | null } | undefined)?.allegro_description) ?? "",
          ),
          jakosc_danych: ((e as { data_sufficiency?: string | null } | undefined)?.data_sufficiency) ?? "",
          miniatura_url: thumb,
          wizualizacje_urls: visuals.join(";"),
          galeria_urls: hostedGallery.join(";"),
          zdjecia_lacznie: (thumb ? 1 : 0) + visuals.length + hostedGallery.length,
        });
        continue;
      }

      const base = {
        id: p.ext_id ?? "",
        nazwa: p.nazwa ?? "",
        kod: p.kod ?? "",
        ean: p.ean ?? "",
        status: e?.status ?? "PENDING",
        match_type: e?.match_type ?? "NO_MATCH",
        matched_term: e?.matched_term ?? "",
        url_1: urls[0] ?? "",
        url_2: urls[1] ?? "",
        url_3: urls[2] ?? "",
        image_1: images[0] ?? "",
        image_2: images[1] ?? "",
        image_3: images[2] ?? "",
        images_all: images.join(" | "),
        Final_main_image: listImages[0] ?? "",
        Final_images: listImages.join(","),
        ai_image_main: regen,
        ai_gallery_all: gallery.join(" | "),
        ...galleryCols,
        allegro_main_image: allegroMainImage,
        golden_name: e?.golden_name ?? "",
        golden_description: e?.golden_description ?? "",
        golden_slug: ((e as { golden_slug?: string | null } | undefined)?.golden_slug) ?? "",
        golden_meta_description: ((e as { golden_meta_description?: string | null } | undefined)?.golden_meta_description) ?? "",
        golden_seo_keywords: (((e as { golden_seo_keywords?: string[] | null } | undefined)?.golden_seo_keywords) ?? []).join(" | "),
        features_text: features.map((f) => `${f.key}: ${f.value}`).join(" | "),
        ...featureCols,
        allegro_description: sanitizeAllegroHtml(
          ((e as { allegro_description?: string | null } | undefined)?.allegro_description) ?? "",
        ),
        allegro_generated_at: ((e as { allegro_generated_at?: string | null } | undefined)?.allegro_generated_at) ?? "",
        model: e?.model ?? "",
        generated_at: e?.generated_at ?? "",
      };
      if (mode !== "qc") { rows.push(base); continue; }

      // --- QC / roboczy columns --------------------------------------------
      const pipeline = ((p as { pipeline_status?: string | null }).pipeline_status ?? "IMPORTED") as PimPipelineStatus;
      const audit = ((e as { audit?: AuditPayload } | undefined)?.audit ?? null) as AuditPayload;
      const factual = audit?.llm?.factual_issues ?? [];
      const guideline = audit?.llm?.guideline_violations ?? [];
      const uwagi = [...factual, ...guideline].filter(Boolean).join("; ").slice(0, 500);
      const scoreBreakdown = ((e as { score_breakdown?: Array<{ ean_confirmed?: boolean }> | null } | undefined)?.score_breakdown) ?? [];
      const eanConfirmed = scoreBreakdown.filter((s) => s?.ean_confirmed === true).length;
      const mainUrl = allegroMainImage || listImages[0] || "";
      const mainScore = mainUrl ? (identityScores as Record<string, GalleryImageScore>)[mainUrl] : undefined;
      const mainPx = mainScore?.w && mainScore?.h ? `${mainScore.w}x${mainScore.h}` : "";
      rows.push({
        ...base,
        status_pipeline: PIPELINE_STATUS_LABEL[pipeline] ?? pipeline,
        status_review: (p as { review_status?: string | null }).review_status ?? "",
        zatwierdzony_kiedy: (p as { approved_at?: string | null }).approved_at ?? "",
        blokada_reczna: (p as { manual_lock?: boolean | null }).manual_lock ? "TAK" : "",
        jakosc_danych: ((e as { data_sufficiency?: string | null } | undefined)?.data_sufficiency) ?? "",
        audyt_werdykt: audit?.verdict ?? "",
        audyt_uwagi: uwagi,
        zrodla_ean_potwierdzone: eanConfirmed,
        zdjecie_glowne_px: mainPx,
      });
    }
    return rows;
  });
