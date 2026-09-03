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
    title: "Twoje dane",
    sentence: "Eksport produktów ze sklepu albo dostęp do panelu. Nic więcej.",
    actor: "you",
    preview: "file",
  },
  {
    id: "sources",
    index: 2,
    title: "Źródła i EAN",
    sentence: "Strony opisujące dokładnie ten produkt, potwierdzone po kodzie EAN.",
    actor: "ai",
    preview: "sources",
  },
  {
    id: "copy",
    index: 3,
    title: "Treści karty",
    sentence: "Nazwa, opis, cechy, kategoria, tytuł i opis SEO, frazy, opis Allegro.",
    actor: "ai",
    preview: "copy",
  },
  {
    id: "photos",
    index: 4,
    title: "Zdjęcia",
    sentence: "Packshot na białym tle i aranżacja produktu w scenerii.",
    actor: "ai",
    preview: "photo",
  },
  {
    id: "qc",
    index: 5,
    title: "Kontrola i redaktor",
    sentence: "Automatyczne testy każdej karty, potem redaktor czyta i poprawia.",
    actor: "human",
    preview: "qc",
  },
  {
    id: "publish",
    index: 6,
    title: "Akceptacja i wgranie",
    sentence: "Akceptujesz w podglądzie. Wgrywamy do sklepu albo oddajemy plik.",
    actor: "human",
    preview: "publish",
  },
];

