import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Zwraca czytelny komunikat błędu. Jeśli serwer zwrócił HTML (np. "This page
// didn't load") albo bardzo długi tekst, używamy podanego fallbacku, żeby nie
// wyświetlać użytkownikowi stron błędu w toast'cie.
export function friendlyError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (trimmed.startsWith("<") || /<!doctype/i.test(trimmed)) return fallback;
  if (trimmed.length > 240) return fallback;
  return trimmed;
}
