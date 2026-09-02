import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Container } from "@/components/ui-custom/Container";
import { GlassCard } from "@/components/ui-custom/GlassCard";
import { AccentButton } from "@/components/ui-custom/Buttons";
import {
  sampleRequestSchema,
  submitSampleRequest,
  type SampleRequestInput,
} from "@/lib/landing/sample-requests.functions";

const benefits = ["Bez zobowiązań", "Do 2 dni roboczych", "Gotowe do publikacji"];

const fieldStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--glass-border-strong)",
  borderRadius: "var(--radius-button)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-body)",
} as const;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-[13px]" style={{ color: "var(--danger)", fontFamily: "var(--font-body)" }}>
      {message}
    </p>
  );
}

function SampleForm() {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const submit = useServerFn(submitSampleRequest);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SampleRequestInput>({
    resolver: zodResolver(sampleRequestSchema),
    defaultValues: { productsRange: "do 100", company: "" },
  });

  if (sent) {
    return (
      <GlassCard padding="lg" className="flex flex-col items-center gap-4 text-center">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--accent)" }}
        >
          <Check className="h-6 w-6" strokeWidth={3} style={{ color: "var(--accent-ink)" }} />
        </span>
        <p
          className="text-base"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-body)" }}
        >
          Dziękujemy. Odezwiemy się w ciągu jednego dnia roboczego.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard padding="md">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(async (values) => {
          setServerError(null);
          try {
            await submit({ data: values });
            setSent(true);
          } catch {
            setServerError("Nie udało się wysłać zgłoszenia. Spróbuj ponownie.");
          }
        })}
      >
        <div className="flex flex-col gap-1.5">
          <label className="lp-caption" style={{ color: "var(--text-secondary)" }}>
            Adres Twojego sklepu
          </label>
          <input
            type="url"
            placeholder="https://twojsklep.pl"
            className="h-11 px-4 text-[0.9375rem] outline-none"
            style={fieldStyle}
            {...register("storeUrl")}
          />
          <FieldError message={errors.storeUrl?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="lp-caption" style={{ color: "var(--text-secondary)" }}>
            Ile masz produktów?
          </label>
          <select
            className="h-11 px-4 text-[0.9375rem] outline-none"
            style={fieldStyle}
            {...register("productsRange")}
          >
            <option value="do 100">do 100</option>
            <option value="100 do 1 000">100 do 1 000</option>
            <option value="ponad 1 000">ponad 1 000</option>
          </select>
          <FieldError message={errors.productsRange?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="lp-caption" style={{ color: "var(--text-secondary)" }}>
            E-mail
          </label>
          <input
            type="email"
            placeholder="imie@firma.pl"
            className="h-11 px-4 text-[0.9375rem] outline-none"
            style={fieldStyle}
            {...register("email")}
          />
          <FieldError message={errors.email?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="lp-caption" style={{ color: "var(--text-secondary)" }}>
            Co jest dla Ciebie najważniejsze? (opcjonalnie)
          </label>
          <textarea
            rows={2}
            className="resize-none px-4 py-3 text-[0.9375rem] outline-none"
            style={fieldStyle}
            {...register("message")}
          />
          <FieldError message={errors.message?.message} />
        </div>

        <div aria-hidden className="hidden">
          <label>
            Nie wypełniaj tego pola
            <input type="text" tabIndex={-1} autoComplete="off" {...register("company")} />
          </label>
        </div>

        <AccentButton size="lg" type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Wysyłanie..." : "Zamów bezpłatną próbkę"}
        </AccentButton>

        {serverError ? <FieldError message={serverError} /> : null}

        <p className="lp-caption" style={{ color: "var(--text-muted)" }}>
          Zamiast formularza możesz napisać na [ADRES E-MAIL].
        </p>
      </form>
    </GlassCard>
  );
}

export function ContactSection() {
  return (
    <section id="contact" className="scroll-mt-24 py-20 md:py-28">
      <Container>
        <GlassCard
          variant="strong"
          padding="none"
          className="relative overflow-hidden"
          style={{ borderRadius: 32 }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(270deg, var(--accent-soft) 0%, rgba(0,0,0,0) 70%)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
            style={{ background: "var(--accent-glow)", filter: "blur(90px)" }}
          />

          <div className="relative grid grid-cols-1 gap-10 p-7 md:grid-cols-2 md:gap-14 md:p-14">
            <div className="flex flex-col gap-4">
              <span className="lp-caption" style={{ color: "var(--accent)" }}>
                Bezpłatna próbka
              </span>
              <h2 className="lp-h2" style={{ color: "var(--text-primary)" }}>
                Wybierzemy 5 Twoich produktów i przygotujemy gotowe karty.
              </h2>
              <p className="lp-lead" style={{ color: "var(--text-secondary)" }}>
                Zobaczysz efekt na własnym asortymencie, zanim cokolwiek zamówisz. Odpowiadamy w
                ciągu jednego dnia roboczego.
              </p>
              <ul className="mt-2 flex flex-col gap-3">
                {benefits.map((b) => (
                  <li
                    key={b}
                    className="flex items-center gap-3 text-[0.9375rem]"
                    style={{ color: "var(--text-primary)", fontFamily: "var(--font-body)" }}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "var(--accent-soft)" }}
                    >
                      <Check
                        className="h-3 w-3"
                        strokeWidth={3}
                        style={{ color: "var(--accent)" }}
                      />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            <SampleForm />
          </div>
        </GlassCard>
      </Container>
    </section>
  );
}

export default ContactSection;
