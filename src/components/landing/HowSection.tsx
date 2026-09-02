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
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { FieldTile } from "./FieldTile";

const TILES = [
  { icon: Type, label: "Nazwa", badge: "PL/EN/DE" },
  { icon: AlignLeft, label: "Opis", badge: "HTML" },
  { icon: ListChecks, label: "Cechy", badge: "lista" },
  { icon: FolderTree, label: "Kategoria", badge: "drzewo sklepu" },
  { icon: Search, label: "Tytuł SEO", badge: "60 zn." },
  { icon: FileText, label: "Opis SEO", badge: "155 zn." },
  { icon: Layers, label: "Warianty", badge: "kolor / rozmiar" },
  { icon: ImageIcon, label: "Zdjęcia lifestyle", badge: "na życzenie", planned: true },
];

export function HowSection() {
  return (
    <section id="scope" className="py-20 md:py-28">
      <Container>
        <SectionHeading
          eyebrow="Co dostajesz"
          title="Osiem pól karty produktu. Wszystkie w cenie."
          lead="Każde pole przygotowujemy osobno i osobno je sprawdzamy, więc możesz zaakceptować całość albo poprosić o poprawkę tylko tam, gdzie chcesz."
        />

        <div className="mt-14 grid grid-cols-2 gap-8 sm:grid-cols-4 xl:grid-cols-8">
          {TILES.map((tile) => (
            <FieldTile key={tile.label} {...tile} />
          ))}
        </div>

        <p
          className="mt-14 text-center lp-body"
          style={{ color: "var(--text-secondary)" }}
        >
          Treści piszemy po polsku zgodnie z tonem Twojej marki. Na życzenie także po angielsku i
          niemiecku.
        </p>

      </Container>
    </section>
  );
}

export default HowSection;
