import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PhotoProject = {
  id: string;
  name: string;
  variants_per_product: number;
  style_prompt: string | null;
  created_at: string;
  updated_at: string;
};

export type PhotoProductStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

export type PhotoProduct = {
  id: string;
  project_id: string;
  name: string | null;
  description: string | null;
  source_image_url: string;
  thumbnail_url: string | null;
  lifestyle_urls: string[];
  status: PhotoProductStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapProduct(row: Record<string, unknown>): PhotoProduct {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: (row.name as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    source_image_url: row.source_image_url as string,
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    lifestyle_urls: Array.isArray(row.lifestyle_urls) ? (row.lifestyle_urls as string[]) : [],
    status: (row.status as PhotoProductStatus) ?? "PENDING",
    last_error: (row.last_error as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export const listPhotoProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("photo_projects" as never)
      .select("id, name, variants_per_product, style_prompt, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown) as PhotoProject[];
  });

export const createPhotoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ name: z.string().min(1).max(120) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("photo_projects" as never)
      .insert({ name: data.name, user_id: context.userId } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row as { id: string };
  });

export const deletePhotoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("photo_projects" as never).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updatePhotoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        variants_per_product: z.number().int().min(0).max(4).optional(),
        style_prompt: z.string().max(2000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("photo_projects" as never)
      .update(patch as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getPhotoProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("photo_projects" as never)
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Nie znaleziono projektu");
    const { data: products, error: pErr } = await context.supabase
      .from("photo_products" as never)
      .select("*")
      .eq("project_id", data.id)
      .order("created_at", { ascending: true });
    if (pErr) throw new Error(pErr.message);
    return {
      project: (project as unknown) as PhotoProject,
      products: ((products ?? []) as Record<string, unknown>[]).map(mapProduct),
    };
  });

export const addPhotoProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        projectId: z.string().uuid(),
        name: z.string().max(400).optional().nullable(),
        description: z.string().max(8000).optional().nullable(),
        source_image_url: z.string().url().max(2000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("photo_products" as never)
      .insert({
        project_id: data.projectId,
        user_id: context.userId,
        name: data.name ?? null,
        description: data.description ?? null,
        source_image_url: data.source_image_url,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row as { id: string };
  });

export const deletePhotoProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("photo_products" as never).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });