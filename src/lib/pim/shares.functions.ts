import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getVisibleGallery, type GalleryImageScore } from "@/lib/pim/gallery";
import { resolveRegenUrl } from "@/lib/pim/media";

// UWAGA: node:crypto NIE MOŻE być importowane na top-level tego pliku,
// bo `.functions.ts` jest w grafie klienta. Ładujemy helpery dynamicznie
// wewnątrz `.handler()` przez `@/lib/pim/shares-crypto.server`.

export type SharePublicEnrichment = {
  golden_name: string | null;
  golden_description: string | null;
  golden_features: Array<{ key: string; value: string }> | null;
  golden_slug: string | null;
  golden_meta_description: string | null;
  /** Preferred hero image (regen if present, otherwise first accepted). */
  main_image_url: string | null;
  /** Accepted product photos, main first. AI verdicts already applied server-side. */
  images: string[];
  /** AI-generated visualizations, kept as a separate labeled gallery. */
  ai_visualizations: string[];
  status: string;
};

export type SharePublicProduct = {
  id: string;
  nazwa: string | null;
  kod: string | null;
  ean: string | null;
  enrichment: SharePublicEnrichment | null;
  feedback: { comments: number; fixes: number };
};

type RawEnrichmentRow = {
  golden_name: string | null;
  golden_description: string | null;
  golden_features: Array<{ key: string; value: string }> | null;
  golden_slug: string | null;
  golden_meta_description: string | null;
  picked_urls: string[] | null;
  regenerated_main_image: string | null;
  pinned_main_url: string | null;
  ai_gallery_urls: string[] | null;
  hidden_images: string[] | null;
  image_scores: Record<string, GalleryImageScore | undefined> | null;
  status: string;
} | null;

function toPublicEnrichment(e: RawEnrichmentRow): SharePublicEnrichment | null {
  if (!e) return null;
  const pinned = e.pinned_main_url ?? null;
  const regen = resolveRegenUrl(e.regenerated_main_image);
  const base: string[] = [];
  if (pinned) base.push(pinned);
  for (const u of e.picked_urls ?? []) {
    if (u && !base.includes(u)) base.push(u);
  }
  const { accepted } = getVisibleGallery(base, {
    hidden_images: e.hidden_images ?? null,
    image_scores: e.image_scores ?? null,
    pinned_main_url: pinned,
  });
  const images: string[] = [];
  if (regen) images.push(regen);
  for (const u of accepted) {
    if (u && !images.includes(u)) images.push(u);
  }
  const aiViz = (e.ai_gallery_urls ?? []).filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  return {
    golden_name: e.golden_name,
    golden_description: e.golden_description,
    golden_features: e.golden_features,
    golden_slug: e.golden_slug,
    golden_meta_description: e.golden_meta_description,
    main_image_url: images[0] ?? null,
    images,
    ai_visualizations: aiViz,
    status: e.status,
  };
}

// -------- OWNER: create / rotate / revoke --------

export const upsertProjectShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      projectId: z.string().uuid(),
      password: z.string().min(4).max(200),
      rotateToken: z.boolean().optional(),
      approvedOnly: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // sanity: właściciel?
    const { data: proj, error: pe } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (pe || !proj) throw new Error("Nie masz dostępu do tego projektu");

    const { hashPassword, genToken, genSalt } = await import("@/lib/pim/shares-crypto.server");
    const salt = genSalt();
    const password_hash = hashPassword(data.password, salt);

    const { data: existing } = await supabase
      .from("project_shares")
      .select("id, token")
      .eq("project_id", data.projectId)
      .maybeSingle();

    if (existing) {
      const token = data.rotateToken ? genToken() : (existing as { token: string }).token;
      const patch: Record<string, unknown> = {
        password_hash,
        salt,
        password_updated_at: new Date().toISOString(),
        is_active: true,
        token,
      };
      if (typeof data.approvedOnly === "boolean") patch.approved_only = data.approvedOnly;
      const { data: updated, error } = await supabase
        .from("project_shares")
        .update(patch as never)
        .eq("id", (existing as { id: string }).id)
        .select("token, is_active, approved_only")
        .single();
      if (error) throw new Error(error.message);
      return updated as { token: string; is_active: boolean; approved_only: boolean };
    }

    const token = genToken();
    const { data: inserted, error } = await supabase
      .from("project_shares")
      .insert({
        project_id: data.projectId,
        token,
        password_hash,
        salt,
        created_by: userId,
        approved_only: data.approvedOnly ?? false,
      } as never)
      .select("token, is_active, approved_only")
      .single();
    if (error) throw new Error(error.message);
    return inserted as { token: string; is_active: boolean; approved_only: boolean };
  });

export const getProjectShare = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("project_shares")
      .select("token, is_active, approved_only, password_updated_at, created_at")
      .eq("project_id", data.projectId)
      .maybeSingle();
    return row as
      | { token: string; is_active: boolean; approved_only: boolean; password_updated_at: string; created_at: string }
      | null;
  });

export const setShareActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ projectId: z.string().uuid(), active: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("project_shares")
      .update({ is_active: data.active } as never)
      .eq("project_id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setShareApprovedOnly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ projectId: z.string().uuid(), approvedOnly: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("project_shares")
      .update({ approved_only: data.approvedOnly } as never)
      .eq("project_id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- OWNER: feedback list / resolve / delete --------

export const listProjectFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("client_feedback")
      .select("id, product_id, kind, body, author_name, resolved, created_at")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string;
      product_id: string | null;
      kind: "comment" | "needs_fix";
      body: string;
      author_name: string | null;
      resolved: boolean;
      created_at: string;
    }>;
  });

export const resolveFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ id: z.string().uuid(), resolved: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("client_feedback")
      .update({ resolved: data.resolved } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("client_feedback").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- PUBLIC (unauthenticated) --------

async function loadShareForPublic(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("project_shares")
    .select("token, project_id, password_hash, salt, password_updated_at, is_active, approved_only")
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return null;
  return data as {
    token: string;
    project_id: string;
    password_hash: string;
    salt: string;
    password_updated_at: string;
    is_active: boolean;
    approved_only: boolean;
  };
}

export const unlockShare = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({ token: z.string().min(8).max(64), password: z.string().min(1).max(200) }).parse(i),
  )
  .handler(async ({ data }) => {
    const share = await loadShareForPublic(data.token);
    if (!share || !share.is_active) throw new Error("Link jest nieaktywny lub nie istnieje");
    const { passwordsMatch, signSession } = await import("@/lib/pim/shares-crypto.server");
    if (!passwordsMatch(data.password, share.salt, share.password_hash)) {
      throw new Error("Nieprawidłowe hasło");
    }
    const session = signSession(share.token, share.password_updated_at);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: proj } = await supabaseAdmin
      .from("projects")
      .select("name")
      .eq("id", share.project_id)
      .maybeSingle();
    return {
      session,
      projectName: (proj as { name?: string } | null)?.name ?? "Projekt",
    };
  });

async function requirePublicSession(token: string, session: string) {
  const share = await loadShareForPublic(token);
  if (!share || !share.is_active) throw new Error("Link nieaktywny");
  const { verifySession } = await import("@/lib/pim/shares-crypto.server");
  if (!verifySession(session, share.token, share.password_updated_at)) {
    throw new Error("Sesja wygasła — zaloguj się ponownie");
  }
  return share;
}

export const listShareProducts = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({ token: z.string(), session: z.string() }).parse(i),
  )
  .handler(async ({ data }) => {
    const share = await requirePublicSession(data.token, data.session);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: proj } = await supabaseAdmin
      .from("projects")
      .select("name")
      .eq("id", share.project_id)
      .maybeSingle();
    let productQ = supabaseAdmin
      .from("source_products")
      .select(`
        id,
        nazwa,
        kod,
        ean,
        enrichment:enrichments (
          golden_name,
          golden_description,
          golden_features,
          golden_slug,
          golden_meta_description,
          picked_urls,
          regenerated_main_image,
          pinned_main_url,
          ai_gallery_urls,
          hidden_images,
          image_scores,
          status
        )
      `)
      .eq("project_id", share.project_id);
    if (share.approved_only) productQ = productQ.eq("review_status", "APPROVED");
    const { data: products, error } = await productQ
      .order("nazwa", { ascending: true })
      .limit(2000);
    if (error) throw new Error(error.message);

    // liczniki feedbacku per produkt
    const { data: fb } = await supabaseAdmin
      .from("client_feedback")
      .select("product_id, kind, resolved")
      .eq("project_id", share.project_id);
    const fbMap = new Map<string, { comments: number; fixes: number }>();
    for (const f of (fb ?? []) as Array<{ product_id: string | null; kind: string; resolved: boolean }>) {
      if (!f.product_id) continue;
      const cur = fbMap.get(f.product_id) ?? { comments: 0, fixes: 0 };
      if (f.kind === "needs_fix" && !f.resolved) cur.fixes += 1;
      else if (f.kind === "comment") cur.comments += 1;
      fbMap.set(f.product_id, cur);
    }

    const outRaw = (products ?? []).map((p) => {
      const row = p as {
        id: string;
        nazwa: string | null;
        kod: string | null;
        ean: string | null;
        enrichment: RawEnrichmentRow | RawEnrichmentRow[] | null;
      };
      const enRaw = Array.isArray(row.enrichment) ? row.enrichment[0] ?? null : row.enrichment;
      const fbc = fbMap.get(row.id) ?? { comments: 0, fixes: 0 };
      const out: SharePublicProduct = {
        id: row.id,
        nazwa: row.nazwa,
        kod: row.kod,
        ean: row.ean,
        enrichment: toPublicEnrichment(enRaw ?? null),
        feedback: fbc,
      };
      return out;
    });
    const payload = {
      projectName: (proj as { name?: string } | null)?.name ?? "Projekt",
      products: outRaw,
    };
    // Round-trip przez JSON gwarantuje serializowalność (TSS strict).
    return JSON.parse(JSON.stringify(payload)) as {
      projectName: string;
      products: SharePublicProduct[];
    };
  });

export const submitShareFeedback = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({
      token: z.string(),
      session: z.string(),
      productId: z.string().uuid().nullable().optional(),
      kind: z.enum(["comment", "needs_fix"]),
      body: z.string().trim().min(1).max(4000),
      authorName: z.string().trim().max(120).optional().nullable(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const share = await requirePublicSession(data.token, data.session);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // sanity: produkt należy do projektu
    if (data.productId) {
      const { data: sp } = await supabaseAdmin
        .from("source_products")
        .select("project_id")
        .eq("id", data.productId)
        .maybeSingle();
      if (!sp || (sp as { project_id: string }).project_id !== share.project_id) {
        throw new Error("Produkt nie należy do tego projektu");
      }
    }
    const { data: row, error } = await supabaseAdmin
      .from("client_feedback")
      .insert({
        project_id: share.project_id,
        product_id: data.productId ?? null,
        kind: data.kind,
        body: data.body,
        author_name: data.authorName ?? null,
        share_token: share.token,
      } as never)
      .select("id, created_at")
      .single();
    if (error) throw new Error(error.message);
    // Client-reported "needs fix" on a specific product demotes it back to
    // NEEDS_REVIEW so the review pipeline picks it up again. Only when the
    // current status is APPROVED or NONE — never overwrite AI_FLAGGED.
    if (data.kind === "needs_fix" && data.productId) {
      const { data: cur } = await supabaseAdmin
        .from("source_products")
        .select("review_status")
        .eq("id", data.productId)
        .maybeSingle();
      const rs = (cur as { review_status?: string | null } | null)?.review_status ?? "NONE";
      if (rs === "APPROVED" || rs === "NONE") {
        await supabaseAdmin
          .from("source_products")
          .update({
            review_status: "NEEDS_REVIEW",
            ...(rs === "APPROVED" ? { approved_at: null, approved_by: null } : {}),
          } as never)
          .eq("id", data.productId);
      }
    }
    return row as { id: string; created_at: string };
  });

export const getShareProduct = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z.object({
      token: z.string(),
      session: z.string(),
      productId: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const share = await requirePublicSession(data.token, data.session);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p, error } = await supabaseAdmin
      .from("source_products")
      .select(`
        id,
        nazwa,
        kod,
        ean,
        enrichment:enrichments (
          golden_name,
          golden_description,
          golden_features,
          golden_slug,
          golden_meta_description,
          picked_urls,
          regenerated_main_image,
          pinned_main_url,
          ai_gallery_urls,
          hidden_images,
          image_scores,
          status
        )
      `)
      .eq("id", data.productId)
      .eq("project_id", share.project_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error("Nie znaleziono produktu");
    const row = p as {
      id: string;
      nazwa: string | null;
      kod: string | null;
      ean: string | null;
      enrichment: RawEnrichmentRow | RawEnrichmentRow[] | null;
    };
    const enRaw = Array.isArray(row.enrichment) ? row.enrichment[0] ?? null : row.enrichment;
    const out: SharePublicProduct = {
      id: row.id,
      nazwa: row.nazwa,
      kod: row.kod,
      ean: row.ean,
      enrichment: toPublicEnrichment(enRaw ?? null),
      feedback: { comments: 0, fixes: 0 },
    };
    return JSON.parse(JSON.stringify(out)) as SharePublicProduct;
  });