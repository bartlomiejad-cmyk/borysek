import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

export const sampleRequestSchema = z.object({
  storeUrl: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .max(300, { message: "Adres jest za długi" })
        .url({ message: "Podaj poprawny adres, np. https://twojsklep.pl" }),
    ])
    .optional(),
  productsRange: z.enum(["do 100", "100 do 1 000", "ponad 1 000"], {
    message: "Wybierz liczbę produktów",
  }),
  email: z
    .string()
    .trim()
    .min(1, { message: "Podaj adres e-mail" })
    .max(255, { message: "Adres e-mail jest za długi" })
    .email({ message: "Podaj poprawny adres e-mail" }),
  message: z.string().trim().max(1000, { message: "Maksymalnie 1000 znaków" }).optional(),
  company: z.string().max(200).optional(),
});

export type SampleRequestInput = z.infer<typeof sampleRequestSchema>;

export const submitSampleRequest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => sampleRequestSchema.parse(data))
  .handler(async ({ data }) => {
    // Honeypot: silently accept, never store.
    if (data.company && data.company.trim().length > 0) {
      return { ok: true as const };
    }

    const supabase = createClient<Database>(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );

    const { error } = await supabase.from("sample_requests").insert({
      store_url: data.storeUrl?.length ? data.storeUrl : "",
      products_range: data.productsRange,
      email: data.email,
      message: data.message?.length ? data.message : null,
    });

    if (error) {
      console.error("[sample_requests] insert failed", error.message);
      throw new Error("Nie udało się wysłać zgłoszenia. Spróbuj ponownie.");
    }

    return { ok: true as const };
  });
