export type ProcessActor = "you" | "ai" | "human";

export type ProcessPreview =
  | "file"
  | "sources"
  | "copy"
  | "photo"
  | "qc"
  | "publish";

export type ProcessStep = {
  id: string;
  index: number;
  title: string;
  sentence: string;
  actor: ProcessActor;
  preview: ProcessPreview;
};

export const ACTOR_LABEL: Record<ProcessActor, string> = {
  you: "Ty",
  ai: "AI",
  human: "Człowiek",
};

export const processSteps: ProcessStep[] = [
  {
    id: "input",
    index: 1,
    title: "Dane od Ciebie",
    sentence: "Eksport produktów ze sklepu albo dostęp do panelu.",
    actor: "you",
    preview: "file",
  },
  {
    id: "sources",
    index: 2,
    title: "Źródła i EAN",
    sentence:
      "Znajdujemy w internecie strony opisujące dokładnie ten produkt i potwierdzamy je po kodzie EAN.",
    actor: "ai",
    preview: "sources",
  },
  {
    id: "copy",
    index: 3,
    title: "Treści karty",
    sentence:
      "Nazwa, opis, cechy, kategoria, tytuł i opis SEO, słowa kluczowe, opis Allegro.",
    actor: "ai",
    preview: "copy",
  },
  {
    id: "photos",
    index: 4,
    title: "Zdjęcia",
    sentence: "Packshot na białym tle w standardzie. Zdjęcia aranżacyjne na życzenie.",
    actor: "ai",
    preview: "photo",
  },
  {
    id: "qc",
    index: 5,
    title: "Kontrola jakości i redaktor",
    sentence: "Automatyczne testy każdej karty, potem redaktor czyta i poprawia.",
    actor: "human",
    preview: "qc",
  },
  {
    id: "publish",
    index: 6,
    title: "Twoja akceptacja i publikacja",
    sentence: "Akceptujesz w podglądzie lub arkuszu. Wgrywamy do sklepu albo oddajemy plik.",
    actor: "human",
    preview: "publish",
  },
];
