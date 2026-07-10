import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getProductDetail } from "@/lib/pim/queries.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Search, Sparkles, ShoppingCart, Heart, Share2, Truck, ShieldCheck, RotateCcw } from "lucide-react";
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

  return (
    <main className="min-h-screen bg-background">
      {/* Demo toolbar */}
      <div className="border-b bg-muted/40 px-4 py-2 flex items-center justify-between gap-2 text-xs">
        <Button asChild variant="ghost" size="sm">
          <Link to="/projects/$id/products/$pid" params={{ id, pid }}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Wróć do edycji
          </Link>
        </Button>
        <span className="text-muted-foreground">
          Podgląd karty produktu · dane ze złotego rekordu
        </span>
      </div>

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
          {/* Fake shop header */}
          <header className="border-b bg-background sticky top-0 z-10">
            <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
              <div className="font-serif text-xl tracking-tight">Twój Sklep</div>
              <nav className="hidden md:flex items-center gap-4 text-sm text-muted-foreground">
                <span>Nowości</span><span>Kategorie</span><span>Promocje</span><span>Kontakt</span>
              </nav>
              <div className="ml-auto flex items-center gap-2">
                <div className="hidden md:flex items-center gap-2 border rounded-md px-2 py-1 text-sm text-muted-foreground">
                  <Search className="h-4 w-4" /> Szukaj produktów…
                </div>
                <ShoppingCart className="h-5 w-5" />
              </div>
            </div>
          </header>

          <div className="max-w-6xl mx-auto px-6 py-6">
            <div className="text-xs text-muted-foreground mb-4">
              Sklep › Produkty › <span className="text-foreground">{goldenName ?? product.nazwa}</span>
            </div>

            <div className="grid lg:grid-cols-2 gap-8">
              {/* Gallery */}
              <div>
                <div className="aspect-square rounded-lg border bg-white overflow-hidden flex items-center justify-center">
                  {mainImg ? (
                    <img src={mainImg} alt={goldenName ?? product.nazwa} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <div className="text-muted-foreground text-sm">Brak zdjęcia</div>
                  )}
                </div>
                {gallery.length > 1 && (
                  <div className="mt-3 flex gap-2 flex-wrap">
                    {gallery.slice(0, 12).map((u, i) => (
                      <button
                        key={u}
                        onClick={() => setActiveIdx(i)}
                        className={cn(
                          "h-16 w-16 rounded border bg-white overflow-hidden flex items-center justify-center",
                          i === activeIdx ? "border-primary ring-2 ring-primary/30" : "border-border",
                        )}
                      >
                        <img src={u} alt="" className="max-h-full max-w-full object-contain" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="space-y-5">
                <div>
                  <h1 className="font-serif text-3xl leading-tight tracking-tight">
                    {goldenName ?? product.nazwa}
                  </h1>
                  <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    {product.kod && <span>Kod: <span className="text-foreground">{product.kod}</span></span>}
                    {product.ean && <span>EAN: <span className="text-foreground">{product.ean}</span></span>}
                    {product.ext_id && <span>ID: <span className="text-foreground">{product.ext_id}</span></span>}
                  </div>
                </div>

                <div className="flex items-baseline gap-3">
                  <div className="text-3xl font-semibold">—,— zł</div>
                  <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">Dostępny</Badge>
                </div>

                <div className="flex gap-2">
                  <Button size="lg" className="flex-1">
                    <ShoppingCart className="h-4 w-4 mr-2" /> Dodaj do koszyka
                  </Button>
                  <Button variant="outline" size="lg"><Heart className="h-4 w-4" /></Button>
                  <Button variant="outline" size="lg"><Share2 className="h-4 w-4" /></Button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 border rounded-md p-2"><Truck className="h-4 w-4" /> Wysyłka 24h</div>
                  <div className="flex items-center gap-2 border rounded-md p-2"><ShieldCheck className="h-4 w-4" /> Gwarancja</div>
                  <div className="flex items-center gap-2 border rounded-md p-2"><RotateCcw className="h-4 w-4" /> 14 dni zwrotu</div>
                </div>

                {goldenDesc && (
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Opis</h2>
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground/90 leading-relaxed">
                      {goldenDesc}
                    </div>
                  </div>
                )}

                {features.length > 0 && (
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Specyfikacja</h2>
                    <div className="rounded-md border overflow-hidden">
                      <table className="w-full text-sm">
                        <tbody>
                          {features.map((f, i) => (
                            <tr key={`${f.key}-${i}`} className={i % 2 ? "bg-muted/40" : ""}>
                              <td className="px-3 py-2 font-medium w-1/2 align-top">{f.key}</td>
                              <td className="px-3 py-2 align-top">{f.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Google snippet preview */}
                <div>
                  <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    <Search className="h-4 w-4" /> Podgląd w Google
                  </h2>
                  <div className="rounded-md border p-4 bg-background">
                    <div className="text-xs text-muted-foreground truncate">{previewUrl}</div>
                    <div className="text-[#1a0dab] dark:text-blue-400 text-lg leading-snug mt-0.5 truncate">
                      {goldenName ?? product.nazwa}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {metaDesc ?? goldenDesc?.slice(0, 160) ?? "—"}
                    </div>
                  </div>
                  {keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {keywords.map((k) => (
                        <Badge key={k} variant="secondary" className="text-xs">{k}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
