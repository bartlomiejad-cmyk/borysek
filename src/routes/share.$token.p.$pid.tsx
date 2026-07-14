import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getShareProduct,
  submitShareFeedback,
  type SharePublicProduct,
} from "@/lib/pim/shares.functions";
import { resolveRegenUrl } from "@/lib/pim/media";

export const Route = createFileRoute("/share/$token/p/$pid")({
  head: () => ({
    meta: [
      { title: "Karta produktu — podgląd" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedProductPage,
});

function sessionKey(token: string) {
  return `share-session:${token}`;
}

function SharedProductPage() {
  const { token, pid } = useParams({ from: "/share/$token/p/$pid" });
  const [session, setSession] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSession(window.localStorage.getItem(sessionKey(token)));
    } catch {
      /* noop */
    }
  }, [token]);

  if (!session) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div className="space-y-3">
          <p>Aby otworzyć kartę, wróć do listy i podaj hasło.</p>
          <a href={`/share/${token}`} className="text-primary underline">
            → Otwórz listę
          </a>
        </div>
      </div>
    );
  }

  return <Content token={token} session={session} pid={pid} />;
}

function Content({ token, session, pid }: { token: string; session: string; pid: string }) {
  const fn = useServerFn(getShareProduct);
  const q = useQuery({
    queryKey: ["share-product", token, pid],
    queryFn: () => fn({ data: { token, session, productId: pid } }),
    retry: false,
  });

  const [activeIdx, setActiveIdx] = useState(0);
  const product = q.data;

  const gallery = useMemo<string[]>(() => {
    if (!product) return [];
    const en = product.enrichment;
    const hidden = new Set(en?.hidden_images ?? []);
    const push = (u?: string | null, into?: string[]) => {
      if (u && !hidden.has(u) && into && !into.includes(u)) into.push(u);
    };
    const list: string[] = [];
    push(en?.pinned_main_url ?? null, list);
    push(resolveRegenUrl(en?.regenerated_main_image), list);
    for (const u of en?.ai_gallery_urls ?? []) push(u, list);
    for (const u of en?.picked_urls ?? []) push(u, list);
    return list;
  }, [product]);

  if (q.isLoading || !product) {
    return <main className="min-h-screen grid place-items-center text-muted-foreground">Ładowanie…</main>;
  }

  const en = product.enrichment;
  const name = en?.golden_name ?? product.nazwa ?? "Bez nazwy";
  const features = (en?.golden_features ?? []).filter((f) => f?.key?.trim() && f?.value?.trim());

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors />
      <header className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <a href={`/share/${token}`} className="text-sm text-primary underline">
            ← Wróć do listy
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 grid gap-8 md:grid-cols-[3fr_2fr]">
        <div>
          <div className="rounded-2xl border bg-white overflow-hidden">
            {gallery[activeIdx] ? (
              <img
                src={gallery[activeIdx]}
                alt={name}
                className="w-full h-[440px] object-contain bg-white"
              />
            ) : (
              <div className="h-[440px] grid place-items-center text-muted-foreground">
                brak zdjęć
              </div>
            )}
          </div>
          {gallery.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {gallery.map((u, i) => (
                <button
                  key={u}
                  onClick={() => setActiveIdx(i)}
                  className={`h-20 w-20 shrink-0 rounded-lg border overflow-hidden bg-white ${
                    i === activeIdx ? "ring-2 ring-primary" : ""
                  }`}
                >
                  <img src={u} alt="" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h1 className="font-serif text-3xl">{name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {product.kod ? `Kod: ${product.kod}` : ""}
            {product.ean ? ` · EAN: ${product.ean}` : ""}
          </p>

          {en?.golden_description && (
            <div
              className="prose prose-sm dark:prose-invert max-w-none mt-5"
              dangerouslySetInnerHTML={{ __html: en.golden_description }}
            />
          )}

          {features.length > 0 && (
            <div className="mt-6">
              <h3 className="font-medium mb-2">Parametry</h3>
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {features.map((f, i) => (
                      <tr key={i} className="odd:bg-muted/30">
                        <td className="p-2 font-medium w-1/3">{f.key}</td>
                        <td className="p-2">{f.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-6">
            <h3 className="font-medium mb-2">Zgłoś uwagi do tego produktu</h3>
            <ProductFeedback
              token={token}
              session={session}
              product={product}
              onSaved={() => q.refetch()}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function ProductFeedback({
  token,
  session,
  product,
  onSaved,
}: {
  token: string;
  session: string;
  product: SharePublicProduct;
  onSaved: () => void;
}) {
  const fn = useServerFn(submitShareFeedback);
  const [body, setBody] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [kind, setKind] = useState<"comment" | "needs_fix">("comment");
  const mut = useMutation({
    mutationFn: () =>
      fn({
        data: {
          token,
          session,
          productId: product.id,
          kind,
          body,
          authorName: authorName || null,
        },
      }),
    onSuccess: () => {
      toast.success("Dziękujemy — uwaga została zapisana");
      setBody("");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="space-y-2 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "comment" | "needs_fix")}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          <option value="comment">Komentarz</option>
          <option value="needs_fix">Do poprawy</option>
        </select>
        <Input
          className="h-8 text-sm"
          placeholder="Twoje imię (opcjonalnie)"
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
        />
      </div>
      <Textarea
        rows={4}
        placeholder="Co należy poprawić? Opisz jak najdokładniej."
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={() => mut.mutate()} disabled={body.trim().length === 0 || mut.isPending}>
          {mut.isPending ? "Zapisuję…" : "Wyślij"}
        </Button>
      </div>
    </div>
  );
}