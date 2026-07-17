import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { markProductsAsVariantsOf } from "@/lib/pim/variant-detect.functions";
import { friendlyError } from "@/lib/utils";

type SimpleProduct = { id: string; nazwa: string | null; kod: string | null };

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rows the user selected in the product list to become variants. */
  selectedIds: string[];
  /** Full product list for the picker (parent candidate search). */
  allProducts: SimpleProduct[];
  onDone?: () => void;
}

export function MarkAsVariantsDialog({ projectId, open, onOpenChange, selectedIds, allProducts, onDone }: Props) {
  const qc = useQueryClient();
  const markFn = useServerFn(markProductsAsVariantsOf);
  const [q, setQ] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return allProducts
      .filter((p) => !selectedSet.has(p.id))
      .filter((p) => {
        if (!query) return true;
        const blob = `${p.nazwa ?? ""} ${p.kod ?? ""}`.toLowerCase();
        return blob.includes(query);
      })
      .slice(0, 50);
  }, [q, allProducts, selectedSet]);

  const submit = async () => {
    if (!parentId) return;
    setBusy(true);
    try {
      const res = await markFn({ data: { projectId, parentId, productIds: selectedIds } });
      toast.success(`Oznaczono ${res.updated} produktów jako warianty${res.parentKod ? ` (parent: ${res.parentKod})` : ""}`);
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się oznaczyć wariantów"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Oznacz jako warianty produktu…</DialogTitle>
          <DialogDescription>
            Wybierz produkt główny, do którego {selectedIds.length} zaznaczonych pozycji zostanie przypisanych jako warianty.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Szukaj po nazwie lub kodzie…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-[40vh] overflow-y-auto rounded-md border divide-y">
            {results.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">Brak dopasowań</div>
            ) : (
              results.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setParentId(p.id)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${parentId === p.id ? "bg-muted" : ""}`}
                >
                  <span className="flex-1 truncate">{p.nazwa ?? "(bez nazwy)"}</span>
                  {p.kod && <span className="text-xs text-muted-foreground">{p.kod}</span>}
                </button>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={busy || !parentId || selectedIds.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Oznacz jako warianty
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}