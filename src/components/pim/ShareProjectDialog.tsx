import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Copy, Link as LinkIcon, RefreshCw, MessageSquare } from "lucide-react";
import {
  getProjectShare,
  upsertProjectShare,
  setShareActive,
  setShareApprovedOnly,
  listProjectFeedback,
  resolveFeedback,
  deleteFeedback,
} from "@/lib/pim/shares.functions";

export function ShareProjectDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
}) {
  const qc = useQueryClient();
  const getShareFn = useServerFn(getProjectShare);
  const upsertFn = useServerFn(upsertProjectShare);
  const setActiveFn = useServerFn(setShareActive);
  const setApprovedOnlyFn = useServerFn(setShareApprovedOnly);
  const listFbFn = useServerFn(listProjectFeedback);
  const resolveFn = useServerFn(resolveFeedback);
  const deleteFn = useServerFn(deleteFeedback);

  const share = useQuery({
    queryKey: ["project-share", projectId],
    queryFn: () => getShareFn({ data: { projectId } }),
    enabled: open,
  });

  const fb = useQuery({
    queryKey: ["project-feedback", projectId],
    queryFn: () => listFbFn({ data: { projectId } }),
    enabled: open,
  });

  const [password, setPassword] = useState("");
  useEffect(() => {
    if (!open) setPassword("");
  }, [open]);

  const upsertMut = useMutation({
    mutationFn: (rotate: boolean) =>
      upsertFn({ data: { projectId, password: password || defaultPassword(), rotateToken: rotate } }),
    onSuccess: () => {
      toast.success("Link udostępniania zapisany");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["project-share", projectId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const activeMut = useMutation({
    mutationFn: (active: boolean) => setActiveFn({ data: { projectId, active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-share", projectId] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const approvedOnlyMut = useMutation({
    mutationFn: (v: boolean) => setApprovedOnlyFn({ data: { projectId, approvedOnly: v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-share", projectId] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const url = share.data
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${share.data.token}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Udostępnij projekt klientowi</DialogTitle>
        </DialogHeader>

        {!share.data ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Wygeneruj link chroniony hasłem. Klient zobaczy listę produktów z możliwością komentowania i oznaczania „do poprawy" — bez konieczności logowania i bez dostępu do narzędzia.
            </p>
            <div>
              <Label>Hasło dla klienta</Label>
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ustaw hasło (min. 4 znaki)"
              />
            </div>
            <Button onClick={() => upsertMut.mutate(false)} disabled={password.length < 4 || upsertMut.isPending}>
              <LinkIcon className="h-4 w-4 mr-2" /> Utwórz link
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border p-3 bg-muted/40">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Link publiczny</Label>
              <div className="flex gap-2 mt-1">
                <Input readOnly value={url ?? ""} onFocus={(e) => e.currentTarget.select()} />
                <Button
                  variant="outline"
                  onClick={() => {
                    if (url) {
                      navigator.clipboard.writeText(url);
                      toast.success("Skopiowano");
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Switch
                  checked={share.data.is_active}
                  onCheckedChange={(v) => activeMut.mutate(v)}
                  disabled={activeMut.isPending}
                />
                <span className="text-sm">{share.data.is_active ? "Aktywny" : "Wyłączony"}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Switch
                  checked={!!share.data.approved_only}
                  onCheckedChange={(v) => approvedOnlyMut.mutate(v)}
                  disabled={approvedOnlyMut.isPending}
                />
                <span className="text-sm">Udostępnij tylko zatwierdzone produkty</span>
              </div>
            </div>

            <div className="rounded-xl border p-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Zmiana hasła / rotacja linku</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nowe hasło (min. 4 znaki)"
                />
                <Button
                  variant="outline"
                  onClick={() => upsertMut.mutate(false)}
                  disabled={password.length < 4 || upsertMut.isPending}
                >
                  Zmień hasło
                </Button>
                <Button
                  variant="outline"
                  onClick={() => upsertMut.mutate(true)}
                  disabled={password.length < 4 || upsertMut.isPending}
                  title="Rotacja unieważnia stary link"
                >
                  <RefreshCw className="h-4 w-4 mr-1" /> Rotuj link
                </Button>
              </div>
            </div>

            <div className="rounded-xl border">
              <div className="p-3 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span className="font-medium">Uwagi klienta ({fb.data?.length ?? 0})</span>
                </div>
              </div>
              <div className="max-h-72 overflow-auto divide-y">
                {(fb.data ?? []).length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">Brak uwag.</div>
                )}
                {(fb.data ?? []).map((f) => (
                  <div key={f.id} className="p-3 text-sm space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          f.kind === "needs_fix"
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                            : "bg-muted"
                        }`}
                      >
                        {f.kind === "needs_fix" ? "Do poprawy" : "Komentarz"}
                      </span>
                      {f.resolved && (
                        <span className="text-xs text-emerald-600">rozwiązane</span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(f.created_at).toLocaleString("pl-PL")}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap">{f.body}</div>
                    <div className="flex gap-2 text-xs">
                      {f.product_id && (
                        <a
                          href={`/projects/${projectId}/products/${f.product_id}`}
                          className="text-primary underline"
                        >
                          → produkt
                        </a>
                      )}
                      <button
                        className="ml-auto text-muted-foreground hover:text-foreground"
                        onClick={async () => {
                          await resolveFn({ data: { id: f.id, resolved: !f.resolved } });
                          qc.invalidateQueries({ queryKey: ["project-feedback", projectId] });
                        }}
                      >
                        {f.resolved ? "Cofnij" : "Oznacz jako rozwiązane"}
                      </button>
                      <button
                        className="text-destructive"
                        onClick={async () => {
                          if (!confirm("Usunąć?")) return;
                          await deleteFn({ data: { id: f.id } });
                          qc.invalidateQueries({ queryKey: ["project-feedback", projectId] });
                        }}
                      >
                        Usuń
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function defaultPassword() {
  return Math.random().toString(36).slice(2, 10);
}