import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Startup validation for the Apify SERP provider. Runs one test query so
 * an unsupported location / missing token surfaces in project settings
 * instead of mid-job.
 */
export const testApifySerp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        query: z.string().max(200).optional(),
        gl: z.string().min(2).max(4).optional(),
        hl: z.string().min(2).max(6).optional(),
      })
      .optional()
      .parse(i),
  )
  .handler(async ({ data }) => {
    const { serpSampleQuery } = await import("./apify.server");
    return serpSampleQuery(data?.query ?? "", { gl: data?.gl, hl: data?.hl });
  });