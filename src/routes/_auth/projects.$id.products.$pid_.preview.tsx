import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getProductDetail } from "@/lib/pim/queries.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Search, Sparkles, ShoppingCart, Heart, Share2, Truck, ShieldCheck, RotateCcw,
  Star, ChevronRight, User, Menu, Minus, Plus, Check, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth/projects/$id/products/$pid_/preview")({
  component: ProductPreview,
  head: () => ({ meta: [{ title: "Podgląd karty produktu" }, { name: "robots", content: "noindex" }] }),
});

type Enrichment = {
  id: string;
  golden_name: string | null;
  golden_description: string | null;
  golden_slug: string | null;
  golden_meta_description: string | null;
  golden_seo_keywords: string[] | null;
  golden_features: Array<{ key: string; value: string }> | null;
  ai_gallery_urls: string[] | null;
  regenerated_main_image: string | null;
  pinned_main_url: string | null;
};

function ProductPreview() {
  const { id, pid } = Route.useParams();
  const getFn = useServerFn(getProductDetail);
  const { data, isLoading } = useQuery({
    queryKey: ["product-preview", id, pid],
    queryFn: () => getFn({ data: { projectId: id, productId: pid } }),
  });

  const [activeIdx, setActiveIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<"desc" | "spec" | "seo" | "reviews">("desc");

  // Deterministic demo price derived from product id — stable across renders.
  const demoPrice = useMemo(() => {
    let h = 0;
    for (const c of pid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const value = 49 + (h % 850) + ((h >> 8) % 100) / 100;
    return Math.round(value * 100) / 100;
  }, [pid]);

  const gallery = useMemo<string[]>(() => {
    if (!data) return [];
    const en = data.enrichment as unknown as Enrichment | null;
    const list: string[] = [];
    const push = (u?: string | null) => { if (u && !list.includes(u)) list.push(u); };
    push(en?.pinned_main_url ?? null);
    push(en?.regenerated_main_image ?? null);
    for (const s of data.sources ?? []) {
      for (const u of s.images) push(u);
      for (const u of s.extra_images) push(u);
    }
    for (const u of en?.ai_gallery_urls ?? []) push(u);
    return list;
  }, [data]);

  if (isLoading || !data) {
    return <main className="min-h-screen grid place-items-center text-muted-foreground">Ładowanie…</main>;
  }

  const en = data.enrichment as unknown as Enrichment | null;
  const product = data.product as { nazwa: string; ean: string | null; kod: string | null; ext_id: string | null };
  const goldenName = en?.golden_name?.trim() || null;
  const goldenDesc = en?.golden_description?.trim() || null;
  const features = (en?.golden_features ?? []).filter((f) => f?.key?.trim() && f?.value?.trim());
  const keywords = en?.golden_seo_keywords ?? [];
  const slug = en?.golden_slug ?? null;
  const metaDesc = en?.golden_meta_description ?? null;
  const hasGolden = Boolean(goldenName || goldenDesc || features.length);

  const mainImg = gallery[activeIdx] ?? gallery[0] ?? null;
  const previewOrigin = "https://sklep.example.com";
  const previewUrl = slug ? `${previewOrigin}/${slug}` : `${previewOrigin}/produkt/${product.ext_id ?? pid.slice(0, 8)}`;

  const oldPrice = Math.round(demoPrice * 1.25 * 100) / 100;
  const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " zł";

  return (
    <main className="min-h-screen bg-background">
      {/* Lovable demo bar (not part of the shop) */}
      <div className="border-b bg-muted/40 px-4 py-2 flex items-center justify-between gap-2 text-xs">
        <Button asChild variant="ghost" size="sm">
          <Link to="/projects/$id/products/$pid" params={{ id, pid }}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Wróć do edycji
          </Link>
        </Button>
        <span className="text-muted-foreground flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          Podgląd demo · dane wygenerowane w Lovable PIM (złoty rekord)
        </span>
      </div>

      {/* Fake shop chrome — rendered even without a golden record to keep demo coherent */}
      <header className="border-b bg-background sticky top-0 z-10 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
          <div className="font-serif text-2xl tracking-tight">Sklep Demo</div>
          <nav className="hidden md:flex items-center gap-5 text-sm text-muted-foreground">
            <span className="hover:text-foreground cursor-default">Nowości</span>
            <span className="hover:text-foreground cursor-default">Kategorie</span>
            <span className="hover:text-foreground cursor-default">Promocje</span>
            <span className="hover:text-foreground cursor-default">Blog</span>
            <span className="hover:text-foreground cursor-default">Kontakt</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 border rounded-full px-3 py-1.5 text-sm text-muted-foreground w-64">
              <Search className="h-4 w-4" />
              <span className="truncate">Szukaj produktów…</span>
            </div>
            <Button variant="ghost" size="icon" className="rounded-full"><User className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" className="rounded-full relative">
              <ShoppingCart className="h-5 w-5" />
              <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[10px] rounded-full h-4 min-w-4 px-1 grid place-items-center">0</span>
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full md:hidden"><Menu className="h-5 w-5" /></Button>
          </div>
        </div>
        <div className="border-t bg-muted/30">
          <div className="max-w-6xl mx-auto px-6 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <Truck className="h-3.5 w-3.5" /> Darmowa dostawa od 200 zł · wysyłka 24h · 14 dni na zwrot
          </div>
        </div>
      </header>

      {!hasGolden ? (
        <div className="max-w-2xl mx-auto p-10 text-center space-y-4">
          <Sparkles className="h-10 w-10 text-amber-500 mx-auto" />
          <h1 className="text-2xl font-semibold">Brak złotego rekordu</h1>
          <p className="text-muted-foreground">
            Ten produkt nie ma jeszcze wygenerowanego złotego rekordu. Wygeneruj go w edycji produktu,
            a następnie wróć tutaj, żeby zobaczyć gotową kartę produktową.
          </p>
          <Button asChild>
            <Link to="/projects/$id/products/$pid" params={{ id, pid }}>Przejdź do edycji</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="max-w-6xl mx-auto px-6 py-4">
            <nav className="text-xs text-muted-foreground mb-6 flex items-center gap-1 flex-wrap">
              <span>Sklep</span>
              <ChevronRight className="h-3 w-3" />
              <span>Kategorie</span>
              <ChevronRight className="h-3 w-3" />
              <span>Produkty</span>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground font-medium truncate max-w-[40ch]">{goldenName ?? product.nazwa}</span>
            </nav>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] gap-10">
              {/* Gallery */}
              <div className="space-y-3">
                <div className="relative aspect-square rounded-2xl border bg-white overflow-hidden flex items-center justify-center group">
                  {keywords.length > 0 && (
                    <div className="absolute top-3 left-3 flex flex-col gap-1 z-[1]">
                      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white shadow-sm">Nowość</Badge>
                      {oldPrice > demoPrice && (
                        <Badge variant="secondary" className="bg-rose-600 hover:bg-rose-600 text-white shadow-sm">
                          -{Math.round((1 - demoPrice / oldPrice) * 100)}%
                        </Badge>
                      )}
                    </div>
                  )}
                  {mainImg ? (
                    <img
                      src={mainImg}
                      alt={goldenName ?? product.nazwa}
                      className="max-h-full max-w-full object-contain transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="text-muted-foreground text-sm">Brak zdjęcia</div>
                  )}
                </div>
                {gallery.length > 1 && (
                  <div className="grid grid-cols-6 gap-2">
                    {gallery.slice(0, 12).map((u, i) => (
                      <button
                        key={u}
                        onClick={() => setActiveIdx(i)}
                        className={cn(
                          "aspect-square rounded-lg border bg-white overflow-hidden flex items-center justify-center transition-all",
                          i === activeIdx
                            ? "border-primary ring-2 ring-primary/30 scale-[1.02]"
                            : "border-border hover:border-muted-foreground/50",
                        )}
                      >
                        <img src={u} alt="" className="max-h-full max-w-full object-contain" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Info column */}
              <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-2">
                    {keywords[0] ?? "Marka Demo"}
                  </div>
                  <h1 className="font-serif text-3xl md:text-4xl leading-tight tracking-tight">
                    {goldenName ?? product.nazwa}
                  </h1>
                  <div className="mt-3 flex items-center gap-3 text-sm">
                    <div className="flex items-center gap-0.5 text-amber-500">
                      {[1,2,3,4,5].map((n) => (
                        <Star key={n} className={cn("h-4 w-4", n <= 4 ? "fill-current" : "fill-current opacity-30")} />
                      ))}
                    </div>
                    <span className="text-muted-foreground">4.8 · 127 opinii</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-emerald-600 flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Sprawdzony</span>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    {product.kod && <span>Kod: <span className="text-foreground">{product.kod}</span></span>}
                    {product.ean && <span>EAN: <span className="text-foreground">{product.ean}</span></span>}
                    {product.ext_id && <span>ID: <span className="text-foreground">{product.ext_id}</span></span>}
                  </div>
                </div>

                {metaDesc && (
                  <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
                    {metaDesc}
                  </p>
                )}

                <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <div className="text-4xl font-semibold tracking-tight">{fmt(demoPrice)}</div>
                    <div className="text-base text-muted-foreground line-through">{fmt(oldPrice)}</div>
                    <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">
                      <Check className="h-3 w-3 mr-1" /> Dostępny
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3" /> Cena demonstracyjna · brak w danych źródłowych
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <div className="flex items-center border rounded-full overflow-hidden bg-background">
                      <button
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        className="h-10 w-10 grid place-items-center hover:bg-muted transition"
                        aria-label="Zmniejsz"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <div className="w-10 text-center text-sm font-medium">{qty}</div>
                      <button
                        onClick={() => setQty((q) => Math.min(99, q + 1))}
                        className="h-10 w-10 grid place-items-center hover:bg-muted transition"
                        aria-label="Zwiększ"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <Button size="lg" className="flex-1 rounded-full h-12">
                      <ShoppingCart className="h-4 w-4 mr-2" /> Do koszyka
                    </Button>
                  </div>
                  <Button variant="outline" size="lg" className="w-full rounded-full h-12">
                    Kup teraz
                  </Button>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <button className="flex items-center gap-1.5 hover:text-foreground transition"><Heart className="h-4 w-4" /> Ulubione</button>
                    <button className="flex items-center gap-1.5 hover:text-foreground transition"><Share2 className="h-4 w-4" /> Udostępnij</button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="flex flex-col items-center gap-1 border rounded-lg p-3 text-center">
                    <Truck className="h-5 w-5 text-primary" />
                    <span className="font-medium">Wysyłka 24h</span>
                    <span className="text-muted-foreground">Kurier InPost</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 border rounded-lg p-3 text-center">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    <span className="font-medium">Gwarancja</span>
                    <span className="text-muted-foreground">24 miesiące</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 border rounded-lg p-3 text-center">
                    <RotateCcw className="h-5 w-5 text-primary" />
                    <span className="font-medium">Zwrot</span>
                    <span className="text-muted-foreground">14 dni</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs section */}
            <div className="mt-14">
              <div className="border-b flex items-center gap-6 overflow-x-auto">
                {[
                  { k: "desc" as const, label: "Opis" },
                  { k: "spec" as const, label: `Specyfikacja${features.length ? ` (${features.length})` : ""}` },
                  { k: "seo" as const, label: "Podgląd w Google" },
                  { k: "reviews" as const, label: "Opinie (3)" },
                ].map((t) => (
                  <button
                    key={t.k}
                    onClick={() => setTab(t.k)}
                    className={cn(
                      "py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                      tab === t.k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="py-8">
                {tab === "desc" && (
                  <div className="max-w-3xl">
                    {goldenDesc ? (
                      <div
                        className="prose prose-sm md:prose-base max-w-none text-foreground/90 leading-relaxed font-serif prose-headings:font-serif prose-h3:text-2xl prose-h3:mb-3 prose-p:my-3 prose-ul:my-3 prose-li:my-1"
                        dangerouslySetInnerHTML={{ __html: goldenDesc }}
                      />
                    ) : (
                      <p className="text-muted-foreground">Brak opisu.</p>
                    )}
                  </div>
                )}

                {tab === "spec" && (
                  features.length > 0 ? (
                    <div className="max-w-3xl rounded-xl border overflow-hidden">
                      <table className="w-full text-sm">
                        <tbody>
                          {features.map((f, i) => (
                            <tr key={`${f.key}-${i}`} className={i % 2 ? "bg-muted/40" : ""}>
                              <td className="px-4 py-3 font-medium w-1/2 align-top text-muted-foreground">{f.key}</td>
                              <td className="px-4 py-3 align-top">{f.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Brak wygenerowanej specyfikacji.</p>
                  )
                )}

                {tab === "seo" && (
                  <div className="max-w-2xl space-y-4">
                    <div className="rounded-xl border p-5 bg-background shadow-sm">
                      <div className="text-xs text-muted-foreground truncate">{previewUrl}</div>
                      <div className="text-[#1a0dab] dark:text-blue-400 text-xl leading-snug mt-1 truncate">
                        {goldenName ?? product.nazwa}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {metaDesc ?? goldenDesc?.slice(0, 160) ?? "—"}
                      </div>
                    </div>
                    {keywords.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Słowa kluczowe</div>
                        <div className="flex flex-wrap gap-1.5">
                          {keywords.map((k) => (
                            <Badge key={k} variant="secondary">{k}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {tab === "reviews" && (
                  <div className="max-w-3xl space-y-4">
                    {[
                      { name: "Anna K.", stars: 5, text: "Produkt zgodny z opisem, szybka wysyłka. Polecam!" },
                      { name: "Marek W.", stars: 5, text: "Świetna jakość w tej cenie. Dokładnie to, czego szukałem." },
                      { name: "Kasia P.", stars: 4, text: "Wszystko OK, opakowanie mogłoby być lepsze, ale sam produkt spoko." },
                    ].map((r, i) => (
                      <div key={i} className="border rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{r.name}</div>
                          <div className="flex items-center gap-0.5 text-amber-500">
                            {[1,2,3,4,5].map((n) => (
                              <Star key={n} className={cn("h-3.5 w-3.5", n <= r.stars ? "fill-current" : "fill-current opacity-20")} />
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">{r.text}</p>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground text-center pt-2">Opinie demonstracyjne</p>
                  </div>
                )}
              </div>
            </div>

            {/* Related products */}
            <div className="mt-14">
              <div className="flex items-end justify-between mb-6">
                <h2 className="font-serif text-2xl tracking-tight">Podobne produkty</h2>
                <span className="text-xs text-muted-foreground">Demo</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[0,1,2,3].map((i) => (
                  <div key={i} className="rounded-xl border overflow-hidden hover:shadow-md transition-shadow">
                    <div className="aspect-square bg-muted/40 grid place-items-center text-muted-foreground text-xs">
                      Produkt {i + 1}
                    </div>
                    <div className="p-3 space-y-1">
                      <div className="h-3 bg-muted rounded w-3/4" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                      <div className="h-4 bg-muted rounded w-1/3 mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="mt-16 border-t bg-muted/20">
            <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
              <div>
                <div className="font-serif text-lg mb-2">Sklep Demo</div>
                <p className="text-xs text-muted-foreground">Podgląd karty produktu wygenerowany przez Lovable PIM.</p>
              </div>
              <div>
                <div className="font-medium mb-2">Zakupy</div>
                <ul className="space-y-1 text-muted-foreground text-xs">
                  <li>Dostawa i płatność</li><li>Zwroty</li><li>Reklamacje</li>
                </ul>
              </div>
              <div>
                <div className="font-medium mb-2">Firma</div>
                <ul className="space-y-1 text-muted-foreground text-xs">
                  <li>O nas</li><li>Kontakt</li><li>Blog</li>
                </ul>
              </div>
              <div>
                <div className="font-medium mb-2">Kontakt</div>
                <ul className="space-y-1 text-muted-foreground text-xs">
                  <li>kontakt@sklep-demo.pl</li><li>+48 000 000 000</li>
                </ul>
              </div>
            </div>
            <div className="border-t">
              <div className="max-w-6xl mx-auto px-6 py-3 text-xs text-muted-foreground text-center">
                © Sklep Demo · Widok generowany z Lovable PIM
              </div>
            </div>
          </footer>
        </>
      )}
    </main>
  );
}
