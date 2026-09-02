import {
  AlignLeft,
  FileText,
  FolderTree,
  Image as ImageIcon,
  Layers,
  ListChecks,
  Search,
  Type,
} from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { GlassCard } from "@/components/ui-custom/GlassCard";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { FieldTile } from "./FieldTile";
import { StatCounter } from "./StatCounter";

const TILES = [
  { icon: Type, label: "Nazwa", badge: "PL/EN/DE" },
  { icon: AlignLeft, label: "Opis", badge: "HTML" },
  { icon: ListChecks, label: "Cechy", badge: "lista" },
  { icon: FolderTree, label: "Kategoria", badge: "auto" },
  { icon: Search, label: "Tytuł SEO", badge: "60 zn." },
  { icon: FileText, label: "Opis SEO", badge: "155 zn." },
  { icon: Layers, label: "Warianty", badge: "kolor / rozmiar" },
  { icon: ImageIcon, label: "Zdjęcia lifestyle", badge: "wkrótce", planned: true },
];

const STATS = [
  { value: 20, prefix: "do ", suffix: "x", text: "szybciej niż ręczne uzupełnianie karty" },
  { value: 1, suffix: " klik", text: "od akceptacji do publikacji w sklepie" },
  { value: 100, suffix: "%", text: "pól przechodzi przez człowieka przed wysyłką" },
];

export function HowSection() {
  return (
    <section id="how" className="py-20 md:py-28">
      <Container>
        <SectionHeading
          eyebrow="Co uzupełnia AI"
          title="Osiem pól produktu. Jeden przebieg."
          lead="Każde pole trafia do karty osobno, więc możesz zaakceptować całość albo poprawić tylko to, co chcesz."
        />

        <div className="mt-14 grid grid-cols-2 gap-8 sm:grid-cols-4 xl:grid-cols-8">
          {TILES.map((tile) => (
            <FieldTile key={tile.label} {...tile} />
          ))}
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {STATS.map((stat) => (
            <GlassCard key={stat.text} padding="lg">
              <StatCounter value={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
              <p className="mt-4 lp-body" style={{ color: "var(--text-secondary)" }}>
                {stat.text}
              </p>
            </GlassCard>
          ))}
        </div>
      </Container>
    </section>
  );
}

export default HowSection;
