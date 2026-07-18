import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, X as XIcon } from "lucide-react";
import { proposeVariantGroups, applyVariantGroups } from "@/lib/pim/variant-detect.functions";
import { friendlyError } from "@/lib/utils";

type Proposal = Awaited<ReturnType<typeof proposeVariantGroups>>["proposals"][number];

type GroupState = {
  key: string; // stable key = parentId or first variantId
  proposal: Proposal;
  enabled: boolean;
  createSyntheticParent: boolean;
  ejected: Set<string>; // ids the user removed from this group
};

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productsById: Map<string, { id: string; nazwa: string | null; kod: string | null }>;
  onDone?: () => void;
};

export function DetectVariantsDialog({ projectId, open, onOpenChange, productsById, onDone }: Props) {
  const qc = useQueryClient();
  const proposeFn = useServerFn(proposeVariantGroups);
  const applyFn = useServerFn(applyVariantGroups);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [groups, setGroups] = useState<GroupState[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const res = await proposeFn({ data: { projectId, useAi: true } });
        setTotalCandidates(res.totalCandidates);
        setGroups(
          res.proposals.map((p, idx): GroupState => ({
            key: p.parentId ?? p.variantIds[0] ?? `g${idx}`,
            proposal: p,
            enabled: p.source === "phase1", // AI proposals unchecked by default
            // Default to creating a synthetic parent when the group has no main row,
            // mirroring the auto path (variant-detect.functions.ts). Prevents silent orphaning.
            createSyntheticParent: p.missingParent,
            ejected: new Set(),
          })),
        );
      } catch (e) {
        toast.error(friendlyError(e, "Nie udało się wykryć wariantów"));
        onOpenChange(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, projectId, proposeFn, onOpenChange]);

  const totals = useMemo(() => {
    let g = 0, v = 0;
    for (const gs of groups) {
      if (!gs.enabled) continue;
      const varIds = gs.proposal.variantIds.filter((id) => !gs.ejected.has(id));
      if (!varIds.length) continue;
      g++;
      v += varIds.length;
    }
    return { groups: g, variants: v };
  }, [groups]);

  const labelOf = (id: string) => {
    const p = productsById.get(id);
    if (!p) return id;
    const kod = p.kod ? ` · ${p.kod}` : "";
    return `${p.nazwa ?? "(bez nazwy)"}${kod}`;
  };

  const apply = async () => {
    const orphaning = groups.filter(
      (g) =>
        g.enabled &&
        g.proposal.missingParent &&
        !g.createSyntheticParent &&
        g.proposal.variantIds.some((id) => !g.ejected.has(id)),
    );
    if (orphaning.length > 0) {
      const ok = window.confirm(
        `Ta grupa nie ma produktu głównego — warianty zostaną osierocone (${orphaning.length} ${orphaning.length === 1 ? "grupa" : "grup"}). Kontynuować bez tworzenia rodzica?`,
      );
      if (!ok) return;
    }
    const payload = groups
      .filter((g) => g.enabled)
      .map((g) => ({
        parentId: g.proposal.parentId,
        variantIds: g.proposal.variantIds.filter((id) => !g.ejected.has(id)),
        baseName: g.proposal.baseName,
        baseKod: g.proposal.baseKod,
        createSyntheticParent: g.proposal.missingParent && g.createSyntheticParent,
      }))
      .filter((g) => g.variantIds.length > 0);
    if (!payload.length) {
      toast.info("Brak grup do zastosowania");
      return;
    }
    setApplying(true);
    try {
      const res = await applyFn({ data: { projectId, groups: payload } });
      toast.success(
        `Oznaczono ${res.variants} wariantów w ${res.groups} grupach${res.syntheticParents ? ` (utworzono ${res.syntheticParents} produktów głównych)` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się zastosować grup"));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !applying && onOpenChange(v)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Wykryj warianty (wzorzec)</DialogTitle>
          <DialogDescription>
            Grupowanie po wzorcach nazw i kodów. Sprawdź propozycje i zastosuj wybrane.
            {totalCandidates > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">
                (kandydatów: {totalCandidates})
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Analizuję…
          </div>
        ) : groups.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nie znaleziono żadnych grup wariantów.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
            {groups.map((g, gi) => {
              const varIds = g.proposal.variantIds.filter((id) => !g.ejected.has(id));
              const parent = g.proposal.parentId ? productsById.get(g.proposal.parentId) : null;
              return (
                <div key={g.key} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={g.enabled}
                      onCheckedChange={(v) =>
                        setGroups((prev) => prev.map((x, i) => (i === gi ? { ...x, enabled: !!v } : x)))
                      }
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {parent
                            ? labelOf(parent.id)
                            : g.proposal.baseName || "(brak nazwy bazowej)"}
                        </span>
                        {g.proposal.source === "phase2_ai" && (
                          <Badge variant="outline" className="text-[10px]">AI</Badge>
                        )}
                        {g.proposal.missingParent && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700 dark:text-amber-300">
                            brak wiersza głównego
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {varIds.length} {varIds.length === 1 ? "wariant" : "wariantów"}
                        </span>
                      </div>
                      {g.proposal.missingParent && (
                        <label className="mt-2 flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={g.createSyntheticParent}
                            onCheckedChange={(v) =>
                              setGroups((prev) =>
                                prev.map((x, i) => (i === gi ? { ...x, createSyntheticParent: !!v } : x)),
                              )
                            }
                          />
                          <span>
                            Brak produktu głównego — utwórz go z pierwszego wariantu
                            {g.proposal.baseKod ? ` (kod: ${g.proposal.baseKod})` : ""}
                          </span>
                        </label>
                      )}
                      <ul className="mt-2 space-y-1">
                        {g.proposal.variantIds.map((id) => {
                          const ejected = g.ejected.has(id);
                          return (
                            <li
                              key={id}
                              className={`flex items-center gap-2 pl-4 text-sm ${ejected ? "line-through text-muted-foreground" : ""}`}
                            >
                              <span className="flex-1 truncate">{labelOf(id)}</span>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground"
                                title={ejected ? "Przywróć" : "To nie wariant"}
                                onClick={() =>
                                  setGroups((prev) =>
                                    prev.map((x, i) => {
                                      if (i !== gi) return x;
                                      const s = new Set(x.ejected);
                                      if (s.has(id)) s.delete(id);
                                      else s.add(id);
                                      return { ...x, ejected: s };
                                    }),
                                  )
                                }
                              >
                                <XIcon className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Anuluj
          </Button>
          <Button onClick={apply} disabled={applying || loading || totals.variants === 0}>
            {applying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Zastosuj ({totals.groups} {totals.groups === 1 ? "grupa" : "grup"}, {totals.variants} {totals.variants === 1 ? "wariant" : "wariantów"})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}