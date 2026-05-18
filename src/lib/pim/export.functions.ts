import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const exportProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: products, error } = await supabase
      .from("source_products")
      .select("id, ext_id, nazwa, kod, ean")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = (products ?? []).map((p) => p.id);
    const { data: ens } = await supabase
      .from("enrichments")
      .select("source_product_id, status, match_type, matched_term, picked_urls, golden_name, golden_description, model, generated_at")
      .in("source_product_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const map = new Map((ens ?? []).map((e) => [e.source_product_id, e]));
    return (products ?? []).map((p) => {
      const e = map.get(p.id);
      const urls = (e?.picked_urls as string[] | undefined) ?? [];
      return {
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
        golden_name: e?.golden_name ?? "",
        golden_description: e?.golden_description ?? "",
        model: e?.model ?? "",
        generated_at: e?.generated_at ?? "",
      };
    });
  });