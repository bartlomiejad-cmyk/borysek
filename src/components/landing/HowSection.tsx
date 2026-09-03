import {
  AlignLeft,
  Camera,
  FileText,
  FolderTree,
  Image as ImageIcon,
  Layers,
  ListChecks,
  Search,
  ShoppingBag,
  Type,
} from "lucide-react";
import { Container } from "@/components/ui-custom/Container";
import { SectionHeading } from "@/components/ui-custom/SectionHeading";
import { Reveal } from "@/components/ui-custom/Reveal";
import { FieldTile } from "./FieldTile";

const TILES = [
  { icon: Type, label: "Nazwa", badge: "ton marki" },
  { icon: AlignLeft, label: "Opis", badge: "HTML" },
  { icon: ListChecks, label: "Cechy", badge: "lista" },
  { icon: FolderTree, label: "Kategoria", badge: "drzewo sklepu" },
  { icon: Search, label: "Tytuł SEO", badge: "60 zn." },
  { icon: FileText, label: "Opis SEO", badge: "155 zn." },
  { icon: ShoppingBag, label: "Opis Allegro", badge: "wersja marketplace" },
  { icon: Camera, label: "Packshot na białym tle", badge: "kontrola jakości" },
  { icon: Layers, label: "Warianty", badge: "kolor / rozmiar" },
  { icon: ImageIcon, label: "Zdjęcia aranżacyjne", badge: "na życzenie", planned: true },
];

export function HowSection() {
  return (
    <section id="scope" className="py-20 md:py-32">
      <Container>
        <Reveal>
        <SectionHeading
          eyebrow="Co dostajesz"
          title="Kompletna karta produktu. Od nazwy po zdjęcia."
          lead="Każde pole przygotowujemy osobno i osobno je sprawdzamy, więc możesz zaakceptować całość albo poprosić o poprawkę tylko tam, gdzie chcesz."
        />
        </Reveal>

        <div className="mt-14 grid grid-cols-2 gap-8 sm:grid-cols-4 lg:grid-cols-5">
          {TILES.map((tile, i) => (
            <Reveal key={tile.label} index={i}>
              <FieldTile {...tile} />
            </Reveal>
          ))}
        </div>

        <Reveal>
        <p
          className="lp-body mt-14 text-center"
          style={{ color: "var(--text-secondary)" }}
        >
          Treści piszemy po polsku, zgodnie z tonem Twojej marki. Wszystkie powstają ze
          zweryfikowanych źródeł, z potwierdzeniem zgodności kodów EAN.
        </p>
        </Reveal>

      </Container>
    </section>
  );
}

export default HowSection;
