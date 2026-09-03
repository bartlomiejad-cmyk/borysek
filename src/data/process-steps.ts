export type ProcessActor = "you" | "ai" | "human";

/** Warianty sceny pokazywanej w polu obrazu karty. */
export type ProcessScene = "file" | "sources" | "copy" | "photo" | "qc" | "publish";

export type WideCellStatus = "empty" | "ai" | "verified";

export type ProcessStep = {
  id: string;
  index: number;
  title: string;
  sentence: string;
  actor: ProcessActor;
  scene: ProcessScene;
  /** Nagłówek karty (caption) i pigułka obok niego. */
  caption: string;
  pill: string;
  pillAccent: boolean;
  /** Etykiety pól wypełnionych w tym kroku. */
  filled: string[];
  /** Status wypełnionych pól. */
  status: Exclude<WideCellStatus, "empty">;
  /** Czy pola pojawiają się kolejno (co 120 ms). */
  sequential?: boolean;
  /** Ramka karty w kolorze akcentu. */
  accentBorder?: boolean;
  log: string;
};

export const ACTOR_LABEL: Record<ProcessActor, string> = {
  you: "Ty",
  ai: "AI",
  human: "Człowiek",
};

export const STEP_DURATION_MS = 3200;
export const STEP_PAUSE_MS = 2000;
export const RESUME_DELAY_MS = 800;
export const CLICK_PAUSE_MS = 8000;

const BASE = ["Nazwa", "EAN"];
const CONTENT = [
  "Nazwa",
  "EAN",
  "Kategoria",
  "Cechy",
  "Opis",
  "Tytuł SEO",
  "Opis SEO",
  "Frazy SEO",
  "Allegro",
];
const ALL = [...CONTENT, "Packshot"];

export const processSteps: ProcessStep[] = [
  {
    id: "input",
    index: 1,
    title: "Twoje dane",
    sentence: "Eksport produktów ze sklepu albo dostęp do panelu. Nic więcej.",
    actor: "you",
    scene: "file",
    caption: "IMPORT",
    pill: "z pliku",
    pillAccent: false,
    filled: BASE,
    status: "ai",
    log: "import: 1 produkt, 2 pola z pliku",
  },
  {
    id: "sources",
    index: 2,
    title: "Źródła i EAN",
    sentence:
      "Znajdujemy strony opisujące dokładnie ten produkt i potwierdzamy je po kodzie EAN.",
    actor: "ai",
    scene: "sources",
    caption: "ŹRÓDŁA",
    pill: "3 źródła",
    pillAccent: true,
    filled: BASE,
    status: "ai",
    log: "źródła: 3 strony, EAN 5901234123457 potwierdzony",
  },
  {
    id: "copy",
    index: 3,
    title: "Treści karty",
    sentence: "Nazwa, opis, cechy, kategoria, tytuł i opis SEO, frazy, opis Allegro.",
    actor: "ai",
    scene: "copy",
    caption: "TREŚCI",
    pill: "AI",
    pillAccent: true,
    filled: CONTENT,
    status: "ai",
    sequential: true,
    log: "treści: 8 pól wygenerowanych ze zweryfikowanych źródeł",
  },
  {
    id: "photos",
    index: 4,
    title: "Zdjęcia",
    sentence: "Packshot na białym tle i aranżacja produktu w scenerii.",
    actor: "ai",
    scene: "photo",
    caption: "ZDJĘCIA",
    pill: "AI",
    pillAccent: true,
    filled: ALL,
    status: "ai",
    log: "zdjęcia: packshot na białym tle gotowy",
  },
  {
    id: "qc",
    index: 5,
    title: "Kontrola i redaktor",
    sentence: "Automatyczne testy każdej karty, potem redaktor czyta i poprawia.",
    actor: "human",
    scene: "qc",
    caption: "KONTROLA",
    pill: "redaktor",
    pillAccent: false,
    filled: ALL,
    status: "verified",
    log: "kontrola: 12 testów OK, redaktor: 2 poprawki",
  },
  {
    id: "publish",
    index: 6,
    title: "Akceptacja i wgranie",
    sentence: "Akceptujesz w podglądzie. Wgrywamy do sklepu albo oddajemy plik.",
    actor: "human",
    scene: "publish",
    caption: "OPUBLIKOWANO",
    pill: "W Twoim sklepie",
    pillAccent: true,
    filled: ALL,
    status: "verified",
    accentBorder: true,
    log: "publikacja: karta wgrana do sklepu",
  },
];

/** Surowa nazwa z pliku pokazywana w krokach 1 i 2. */
export const RAW_NAME = "EKSPRES CISNIENIOWY AUTOMAT 15BAR 1,8L CZARNY";
export const DEMO_EAN = "5901234123457";
