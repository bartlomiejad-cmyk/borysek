import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "list_projects",
  title: "Lista projektów",
  description:
    "Zwraca projekty PIM należące do zalogowanego użytkownika (RLS). Każdy projekt zawiera id, nazwę i strategię matchingu.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).default(50).describe("Maks. liczba zwróconych projektów."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("projects")
      .select("id, name, strategy, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return errorResult(error.message);
    return textResult(JSON.stringify(data ?? [], null, 2), { projects: data ?? [] });
  },
});