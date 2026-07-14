import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Startup validation for the Apify SERP provider. Runs one test query so
 * an unsupported location / missing token surfaces in project settings
 * instead of mid-job.
 */
export const testApifySerp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { serpHealthCheck } = await import("./apify.server");
    return serpHealthCheck();
  });