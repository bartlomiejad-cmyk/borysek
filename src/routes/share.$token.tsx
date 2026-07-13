import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  LogOut,
} from "lucide-react";
import {
  listShareProducts,
  submitShareFeedback,
  unlockShare,
  type SharePublicProduct,
} from "@/lib/pim/shares.functions";

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Udostępniona lista produktów" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharePage,
});

function sessionKey(token: string) {
  return `share-session:${token}`;
}

function SharePage() {
  const { token } = useParams({ from: "/share/$token" });
  const [session, setSession] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("");

  useEffect(() => {
    try {
      const s = window.localStorage.getItem(sessionKey(token));
      if (s) setSession(s);
    } catch {
      /* noop */
    }
  }, [token]);

  if (!session) {
    return (
      <UnlockView
        token={token}
        onUnlocked={(sess, name) => {
          try {
            window.localStorage.setItem(sessionKey(token), sess);
          } catch {
            /* noop */
          }
          setSession(sess);
          setProjectName(name);
        }}
      />
    );
  }

  return (
    <UnlockedView
      token={token}
      session={session}
      initialName={projectName}
      onSessionInvalid={() => {
        try {
          window.localStorage.removeItem(sessionKey(token));
        } catch {
          /* noop */
        }
        setSession(null);
      }}
    />
  );
}

function UnlockView({
  token,
  onUnlocked,
}: {
  token: string;
  onUnlocked: (session: string, projectName: string) => void;
}) {
  const unlockFn = useServerFn(unlockShare);
  const [password, setPassword] = useState("");
  const mut = useMutation({
    mutationFn: () => unlockFn({ data: { token, password } }),
    onSuccess: (r) => onUnlocked(r.session, r.projectName),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Toaster richColors />
      <form
        className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <div>
          <h1 className="font-serif text-2xl">Udostępniona lista</h1>
          <p className="text-sm text-muted-foreground">
            Ten link jest chroniony hasłem. Poproś o hasło osobę, która Ci go udostępniła.
          </p>
        </div>
        <div>
          <Label>Hasło</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <Button type="submit" disabled={!password || mut.isPending} className="w-full">
          {mut.isPending ? "Weryfikuję…" : "Odblokuj"}
        </Button>
      </form>
    </div>
  );
}

function UnlockedView({
  token,
  session,
  initialName,
  onSessionInvalid,
}: {
  token: string;
  session: string;
  initialName: string;
  onSessionInvalid: () => void;
}) {
  const listFn = useServerFn(listShareProducts);
  const q = useQuery({
    queryKey: ["share", token],
    queryFn: () => listFn({ data: { token, session } }),
    retry: false,
  });

  useEffect(() => {
    if (q.error) {
      const msg = (q.error as Error).message;
      if (msg.toLowerCase().includes("sesja")) {
        onSessionInvalid();
      } else {
        toast.error(msg);
      }
    }
  }, [q.error, onSessionInvalid]);

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const projectName = q.data?.projectName ?? initialName ?? "Projekt";

  const filtered = useMemo(() => {
    const list = q.data?.products ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((p) =>
      [p.enrichment?.golden_name ?? p.nazwa ?? "", p.kod ?? "", p.ean ?? ""]
        .some((s) => s.toLowerCase().includes(needle)),
    );
  }, [q.data, query]);

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors />
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl truncate">{projectName}</h1>
            <p className="text-xs text-muted-foreground">
              {q.data?.products.length ?? 0} produktów · masz możliwość dodania uwag do każdego z nich
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Input
              placeholder="Szukaj po nazwie, kodzie, EAN"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-64"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={onSessionInvalid}
              title="Wyloguj z podglądu"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {q.isLoading && <p className="text-sm text-muted-foreground">Wczytuję…</p>}
        {q.data && (
          <div className="space-y-3">
            <ProjectFeedbackBlock token={token} session={session} onSaved={() => q.refetch()} />
            {filtered.map((p) => {
              const isOpen = expanded.has(p.id);
              return (
                <ProductCard
                  key={p.id}
                  product={p}
                  isOpen={isOpen}
                  onToggle={() => {
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    });
                  }}
                  token={token}
                  session={session}
                  onFeedbackSaved={() => q.refetch()}
                />
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function pickThumb(p: SharePublicProduct): string | null {
  const en = p.enrichment;
  if (!en) return null;
  if (en.pinned_main_url) return en.pinned_main_url;
  if (en.regenerated_main_image) return en.regenerated_main_image;
  const hidden = new Set(en.hidden_images ?? []);
  const first = (en.picked_urls ?? []).find((u) => !hidden.has(u));
  return first ?? null;
}

function ProductCard({
  product,
  isOpen,
  onToggle,
  token,
  session,
  onFeedbackSaved,
}: {
  product: SharePublicProduct;
  isOpen: boolean;
  onToggle: () => void;
  token: string;
  session: string;
  onFeedbackSaved: () => void;
}) {
  const thumb = pickThumb(product);
  const name = product.enrichment?.golden_name ?? product.nazwa ?? "Bez nazwy";
  const features = product.enrichment?.golden_features ?? [];
  const gallery = [
    ...(product.enrichment?.pinned_main_url ? [product.enrichment.pinned_main_url] : []),
    ...(product.enrichment?.regenerated_main_image
      ? [product.enrichment.regenerated_main_image]
      : []),
    ...((product.enrichment?.ai_gallery_urls ?? []) as string[]),
    ...((product.enrichment?.picked_urls ?? []) as string[]),
  ]
    .filter((u, i, a) => u && a.indexOf(u) === i)
    .filter((u) => !(product.enrichment?.hidden_images ?? []).includes(u));

  const previewHref = `/share/${token}/p/${product.id}`;

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/40 transition"
      >
        <div className="h-16 w-16 shrink-0 rounded-lg bg-muted overflow-hidden flex items-center justify-center">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">brak</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {product.kod ? `Kod: ${product.kod}` : ""}
            {product.ean ? ` · EAN: ${product.ean}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {product.feedback.fixes > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 dark:bg-amber-900/40 dark:text-amber-200">
              <AlertTriangle className="h-3 w-3" /> {product.feedback.fixes}
            </span>
          )}
          {product.feedback.comments > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
              <MessageSquare className="h-3 w-3" /> {product.feedback.comments}
            </span>
          )}
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {isOpen && (
        <div className="border-t p-4 grid gap-4 md:grid-cols-[2fr_1fr]">
          <div>
            {gallery.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {gallery.slice(0, 8).map((u) => (
                  <img
                    key={u}
                    src={u}
                    alt=""
                    className="h-32 rounded-lg border object-contain bg-white"
                  />
                ))}
              </div>
            )}
            {product.enrichment?.golden_description && (
              <div
                className="prose prose-sm dark:prose-invert max-w-none mt-2"
                dangerouslySetInnerHTML={{
                  __html: product.enrichment.golden_description,
                }}
              />
            )}
            {features.length > 0 && (
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Parametry
                </div>
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {features.slice(0, 30).map((f, i) => (
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
            <a
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary underline mt-3"
            >
              Otwórz kartę produktu <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <FeedbackForm
            token={token}
            session={session}
            productId={product.id}
            onSaved={onFeedbackSaved}
          />
        </div>
      )}
    </div>
  );
}

function ProjectFeedbackBlock({
  token,
  session,
  onSaved,
}: {
  token: string;
  session: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border bg-muted/30 p-3">
      <button
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <MessageSquare className="h-4 w-4" />
        <span className="font-medium">Dodaj uwagę ogólną do projektu</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {open ? "ukryj" : "rozwiń"}
        </span>
      </button>
      {open && (
        <div className="mt-3">
          <FeedbackForm token={token} session={session} productId={null} onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}

function FeedbackForm({
  token,
  session,
  productId,
  onSaved,
}: {
  token: string;
  session: string;
  productId: string | null;
  onSaved: () => void;
}) {
  const submitFn = useServerFn(submitShareFeedback);
  const [body, setBody] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [kind, setKind] = useState<"comment" | "needs_fix">("comment");
  const mut = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          token,
          session,
          productId,
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
        rows={3}
        placeholder="Opisz co należy poprawić lub zostaw komentarz…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => mut.mutate()}
          disabled={body.trim().length === 0 || mut.isPending}
        >
          {mut.isPending ? "Zapisuję…" : "Wyślij"}
        </Button>
      </div>
    </div>
  );
}