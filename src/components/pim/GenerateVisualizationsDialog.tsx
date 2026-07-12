import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Wand2, Sparkles, Loader2 } from "lucide-react";
import { createBulkJob } from "@/lib/pim/bulk-jobs.functions";
import { updateProject } from "@/lib/pim/projects.functions";
import { suggestVisualizationField } from "@/lib/pim/ai.functions";
import { friendlyError } from "@/lib/utils";

export type VizTarget = {
  id: string;
  picked_urls?: string[];
  regenerated_main_image?: string | null;
  pinned_main_url?: string | null;
};

type Scope = "selected" | "with_main" | "all";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  allProducts: VizTarget[];
  selectedIds: Set<string>;
  defaultStylePrompt?: string | null;
  defaultRequirementsPl?: string | null;
};

function hasMain(p: VizTarget): boolean {
  if (p.pinned_main_url) return true;
  if (p.regenerated_main_image && p.regenerated_main_image !== "__imported__") return true;
  if (p.picked_urls && p.picked_urls.length > 0) return true;
  return false;
}

export function GenerateVisualizationsDialog({
  open,
  onOpenChange,
  projectId,
  allProducts,
  selectedIds,
  defaultStylePrompt,
  defaultRequirementsPl,
}: Props) {
  const qc = useQueryClient();
  const createJob = useServerFn(createBulkJob);
  const updProject = useServerFn(updateProject);
  const suggestField = useServerFn(suggestVisualizationField);

  const selectedTargets = useMemo(
    () => allProducts.filter((p) => selectedIds.has(p.id)),
    [allProducts, selectedIds],
  );
  const withMainTargets = useMemo(() => allProducts.filter(hasMain), [allProducts]);

  const [scope, setScope] = useState<Scope>(() =>
    selectedIds.size > 0 ? "selected" : "with_main",
  );
  const [count, setCount] = useState(3);
  const [style, setStyle] = useState<string>(defaultStylePrompt ?? "");
  const [reqPl, setReqPl] = useState<string>(defaultRequirementsPl ?? "");
  const [quality, setQuality] = useState<"2K" | "4K">("2K");
  const [busy, setBusy] = useState(false);
  const [busyStyle, setBusyStyle] = useState(false);
  const [busyReq, setBusyReq] = useState(false);

  const suggest = async (field: "style" | "requirements") => {
    const setBusyFn = field === "style" ? setBusyStyle : setBusyReq;
    setBusyFn(true);
    try {
      const { text } = await suggestField({ data: { projectId, field } });
      if (field === "style") setStyle(text);
      else setReqPl(text);
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się wygenerować propozycji"));
    } finally {
      setBusyFn(false);
    }
  };

  // Re-sync form defaults when opened (project settings may have changed).
  useEffect(() => {
    if (!open) return;
    setStyle(defaultStylePrompt ?? "");
    setReqPl(defaultRequirementsPl ?? "");
    setScope(selectedIds.size > 0 ? "selected" : "with_main");
  }, [open, defaultStylePrompt, defaultRequirementsPl, selectedIds]);

  const targets = useMemo(() => {
    if (scope === "selected") return selectedTargets.filter(hasMain);
    if (scope === "with_main") return withMainTargets;
    return allProducts.filter(hasMain); // "all" — still require a main image
  }, [scope, selectedTargets, withMainTargets, allProducts]);

  const total = targets.length;
  const totalRenders = total * count;

  const run = async () => {
    if (count <= 0) {
      toast.info("Ustaw liczbę wizualizacji > 0");
      return;
    }
    if (total === 0) {
      toast.info("Brak produktów z gotowym zdjęciem głównym w wybranym zakresie");
      return;
    }
    setBusy(true);
    try {
      // Persist form defaults on the project so users don't retype them.
      await updProject({
        data: {
          id: projectId,
          visualization_style_prompt: style.trim() || null,
          visualization_requirements_pl: reqPl.trim() || null,
        },
      });
      await createJob({
        data: {
          projectId,
          kind: "PIM_VISUALIZATIONS",
          items: targets.map((t) => t.id),
          payload: {
            count,
            stylePrompt: style.trim(),
            requirementsPl: reqPl.trim(),
            targetResolution: quality === "4K" ? 4096 : 2048,
          },
        },
      });
      qc.invalidateQueries({ queryKey: ["project", projectId, "bulk-job", "PIM_VISUALIZATIONS"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success(`Wizualizacje uruchomione: ${total} produkt(ów) × ${count}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się uruchomić zadania"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!busy ? onOpenChange(v) : undefined)}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" /> Generuj wizualizacje produktowe
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Zakres</Label>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="selected" disabled={selectedIds.size === 0} className="mt-0.5" />
                <div>
                  <div className="font-medium">Zaznaczone ({selectedTargets.filter(hasMain).length}/{selectedIds.size})</div>
                  <div className="text-xs text-muted-foreground">Tylko zaznaczone produkty, które mają zdjęcie główne.</div>
                </div>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="with_main" className="mt-0.5" />
                <div>
                  <div className="font-medium">Wszystkie z gotowym zdjęciem głównym ({withMainTargets.length})</div>
                  <div className="text-xs text-muted-foreground">Produkty w projekcie, dla których pipeline ma packshot lub picked_urls.</div>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-1">
            <Label htmlFor="viz-count">Liczba wizualizacji na produkt (0–8)</Label>
            <Input
              id="viz-count"
              type="number"
              min={0}
              max={8}
              value={count}
              onChange={(e) => setCount(Math.max(0, Math.min(8, Number(e.target.value) || 0)))}
              className="w-24"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="viz-style">Styl / scena (opcjonalnie)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => suggest("style")}
                disabled={busyStyle || busy}
              >
                {busyStyle ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Zaproponuj AI
              </Button>
            </div>
            <Textarea
              id="viz-style"
              rows={2}
              placeholder="np. Nowoczesna kuchnia, blat drewniany, poranne światło z okna, minimalizm."
              value={style}
              onChange={(e) => setStyle(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="viz-req">Wymagania (PL) — AI przepisze na prompt EN</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => suggest("requirements")}
                disabled={busyReq || busy}
              >
                {busyReq ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Zaproponuj AI
              </Button>
            </div>
            <Textarea
              id="viz-req"
              rows={4}
              placeholder="np. Produkt trzymany w dłoni w plenerze, poranne światło, rozmyte tło ogrodu, kąt 3/4."
              value={reqPl}
              onChange={(e) => setReqPl(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Piszesz po polsku co ma być na wizualizacji. Gemini 3.1 Pro tłumaczy to na precyzyjny prompt EN,
              dbając równocześnie, żeby produkt (logo, etykiety, kolory) pozostał wierny oryginałowi.
            </p>
          </div>

          <div className="space-y-1">
            <Label>Jakość</Label>
            <RadioGroup value={quality} onValueChange={(v) => setQuality(v as "2K" | "4K")} className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="2K" /> 2K (social)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="4K" /> 4K (e-commerce)
              </label>
            </RadioGroup>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div>
              <b>{total}</b> produkt(ów) × <b>{count}</b> wizualizacji = <b>{totalRenders}</b> renderów FAL.
            </div>
            {scope === "selected" && selectedTargets.length > selectedTargets.filter(hasMain).length && (
              <div className="text-xs text-muted-foreground mt-1">
                Pominięto {selectedTargets.length - selectedTargets.filter(hasMain).length} produkt(ów) bez zdjęcia głównego.
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 px-6 py-4 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Anuluj
          </Button>
          <Button onClick={run} disabled={busy || count === 0 || total === 0}>
            <Wand2 className="h-4 w-4 mr-2" />
            Uruchom
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}