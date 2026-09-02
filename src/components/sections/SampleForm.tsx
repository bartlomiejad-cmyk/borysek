import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { GlassCard } from "@/components/ui-custom/GlassCard";
import { AccentButton } from "@/components/ui-custom/Buttons";
import {
  sampleRequestSchema,
  submitSampleRequest,
  type SampleRequestInput,
} from "@/lib/landing/sample-requests.functions";

const fieldStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--glass-border-strong)",
  borderRadius: "var(--radius-button)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-body)",
} as const;

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className="min-h-[1rem] text-[13px]"
      style={{ color: "var(--danger)", fontFamily: "var(--font-body)" }}
    >
      {message ?? ""}
    </p>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="lp-caption" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      {children}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function SuccessCard() {
  return (
    <GlassCard padding="lg" className="flex flex-col items-center gap-4 text-center">
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--accent)" }}
      >
        <Check className="h-6 w-6" strokeWidth={3} style={{ color: "var(--accent-ink)" }} />
      </span>
      <p
        role="status"
        aria-live="polite"
        className="text-base"
        style={{ color: "var(--text-primary)", fontFamily: "var(--font-body)" }}
      >
        Dziękujemy. Odezwiemy się w ciągu jednego dnia roboczego.
      </p>
    </GlassCard>
  );
}

export function SampleForm() {
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

  if (sent) return <SuccessCard />;

  const invalid = (name: keyof SampleRequestInput) =>
    errors[name] ? ({ "aria-invalid": true, "aria-describedby": `${name}-error` } as const) : {};

  return (
    <GlassCard padding="md">
      <form
        noValidate
        aria-label="Formularz zamówienia bezpłatnej próbki"
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
        <Field id="storeUrl" label="Adres Twojego sklepu" error={errors.storeUrl?.message}>
          <input
            id="storeUrl"
            type="url"
            placeholder="https://twojsklep.pl"
            className="h-11 px-4 text-[0.9375rem] outline-none"
            style={fieldStyle}
            {...invalid("storeUrl")}
            {...register("storeUrl")}
          />
        </Field>

        <Field id="productsRange" label="Ile masz produktów?" error={errors.productsRange?.message}>
          <select
            id="productsRange"
            className="h-11 px-4 text-[0.9375rem] outline-none"
            style={fieldStyle}
            {...invalid("productsRange")}
            {...register("productsRange")}
          >
            <option value="do 100">do 100</option>
            <option value="100 do 1 000">100 do 1 000</option>
            <option value="ponad 1 000">ponad 1 000</option>
          </select>
        </Field>

        <Field id="email" label="E-mail" error={errors.email?.message}>
          <input
            id="email"
            type="email"
            placeholder="imie@firma.pl"
            className="h-11 px-4 text-[0.9375rem] outline-none"
            style={fieldStyle}
            {...invalid("email")}
            {...register("email")}
          />
        </Field>

        <Field
          id="message"
          label="Co jest dla Ciebie najważniejsze? (opcjonalnie)"
          error={errors.message?.message}
        >
          <textarea
            id="message"
            rows={2}
            className="resize-none px-4 py-3 text-[0.9375rem] outline-none"
            style={fieldStyle}
            {...invalid("message")}
            {...register("message")}
          />
        </Field>

        <div aria-hidden className="hidden">
          <label htmlFor="company">Nie wypełniaj tego pola</label>
          <input id="company" type="text" tabIndex={-1} autoComplete="off" {...register("company")} />
        </div>

        <AccentButton size="lg" type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Wysyłanie..." : "Zamów bezpłatną próbkę"}
        </AccentButton>

        <p
          role="alert"
          aria-live="assertive"
          className="text-[13px]"
          style={{ color: "var(--danger)", fontFamily: "var(--font-body)" }}
        >
          {serverError ?? ""}
        </p>

        <p className="lp-caption" style={{ color: "var(--text-muted)" }}>
          Zamiast formularza możesz napisać na [ADRES E-MAIL].
        </p>
      </form>
    </GlassCard>
  );
}

export default SampleForm;
