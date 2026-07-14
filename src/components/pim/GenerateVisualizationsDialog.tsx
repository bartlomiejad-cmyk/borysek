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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Wand2, Sparkles, Loader2, ImageIcon, ChevronDown } from "lucide-react";
import { createBulkJob } from "@/lib/pim/bulk-jobs.functions";
import { updateProject } from "@/lib/pim/projects.functions";
import {
  analyzeProductImagesForPrompt,
} from "@/lib/pim/ai.functions";
import { friendlyError } from "@/lib/utils";

export type VizTarget = {
  id: string;
  nazwa?: string | null;
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
  projectSettings?: Record<string, unknown> | null;
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
  const analyzeImagesFn = useServerFn(analyzeProductImagesForPrompt);

  const selectedTargets = useMemo(
    () => allProducts.filter((p) => selectedIds.has(p.id)),
    [allProducts, selectedIds],
  );
  const withMainTargets = useMemo(() => allProducts.filter(hasMain), [allProducts]);

  const [scope, setScope] = useState<Scope>(() =>
    selectedIds.size > 0 ? "selected" : "with_main",
  );
  const [count, setCount] = useState(3);
  const [style, setStyle] = useState<string>((defaultStylePrompt ?? "").trim());
  const [reqPl, setReqPl] = useState<string>((defaultRequirementsPl ?? "").trim());
  const [constraintsOpen, setConstraintsOpen] = useState(false);
  const [forceReanalyze, setForceReanalyze] = useState(false);
  const [quality, setQuality] = useState<"2K" | "4K">("2K");
  const [busy, setBusy] = useState(false);
  const [busyPreview, setBusyPreview] = useState(false);
  const [previewProductId, setPreviewProductId] = useState<string>("");
  const [preview, setPreview] = useState<{ style: string; requirements: string; name: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope(selectedIds.size > 0 ? "selected" : "with_main");
    setConstraintsOpen(false);
    setForceReanalyze(false);
    setPreview(null);
    setStyle((defaultStylePrompt ?? "").trim());
    setReqPl((defaultRequirementsPl ?? "").trim());
  }, [open, selectedIds, defaultStylePrompt, defaultRequirementsPl]);

  const targets = useMemo(() => {
    if (scope === "selected") return selectedTargets.filter(hasMain);
    if (scope === "with_main") return withMainTargets;
    return allProducts.filter(hasMain); // "all" — still require a main image
  }, [scope, selectedTargets, withMainTargets, allProducts]);

  const total = targets.length;
  const totalRenders = total * count;

  // Default preview product = first selected-with-main, or first with-main overall.
  useEffect(() => {
    if (!open) return;
    if (previewProductId && targets.some((t) => t.id === previewProductId)) return;
    const first = targets[0] ?? withMainTargets[0];
    setPreviewProductId(first?.id ?? "");
  }, [open, targets, withMainTargets, previewProductId]);

  const runPreview = async () => {
    const pick = allProducts.find((p) => p.id === previewProductId) ?? targets[0] ?? withMainTargets[0];
    if (!pick || !hasMain(pick)) {
      toast.info("Wybierz produkt ze zdjęciem, aby AI mogła przygotować podgląd");
      return;
    }
    setBusyPreview(true);
    try {
      const out = await analyzeImagesFn({
        data: { productId: pick.id, mode: "visualization" },
      });
      setPreview({
        style: out.style,
        requirements: out.requirements,
        name: (pick.nazwa ?? pick.id.slice(0, 8)).trim(),
      });
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się wygenerować podglądu"));
    } finally {
      setBusyPreview(false);
    }
  };

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
      const stylePrompt = style.trim();
      const requirementsPl = reqPl.trim();
      await updProject({
        data: {
          id: projectId,
          visualization_style_prompt: stylePrompt || null,
          visualization_requirements_pl: requirementsPl || null,
        },
      });
      await createJob({
        data: {
          projectId,
          kind: "PIM_VISUALIZATIONS",
          items: targets.map((t) => t.id),
          payload: {
            count,
            stylePrompt,
            requirementsPl,
            force_reanalyze: forceReanalyze,
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
            <Wand2 className="h-5 w-5" /> Generuj miniatury katalogowe (z rekwizytami)
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            Miniatura z rekwizytami nie nadaje się na zdjęcie główne Allegro (na zdjęciu głównym mogą być tylko elementy będące częścią oferty).
          </div>
          <div className="rounded-md border border-violet-200 bg-violet-50/50 dark:bg-violet-950/20 p-3 text-xs">
            <div className="font-medium flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> AI dobiera scenę dla każdego produktu z osobna
            </div>
            <div className="text-muted-foreground mt-1">
              Przed każdą wizualizacją Gemini Vision analizuje zdjęcia danego produktu i pisze spersonalizowany prompt.
              Wynik jest cache'owany na produkcie — kolejne uruchomienia są darmowe, o ile nie zmienią się źródłowe zdjęcia.
            </div>
          </div>

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

          {/* Preview: run analysis for a single product to see the scene AI will pick. */}
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Przykład doboru sceny</Label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={runPreview}
                disabled={busyPreview || busy || !previewProductId}
              >
                {busyPreview ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                )}
                Pokaż podgląd
              </Button>
            </div>
            <select
              className="w-full h-8 rounded-md border bg-background px-2 text-sm"
              value={previewProductId}
              onChange={(e) => {
                setPreviewProductId(e.target.value);
                setPreview(null);
              }}
            >
              {(targets.length ? targets : withMainTargets).slice(0, 200).map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.nazwa ?? p.id.slice(0, 8)).trim()}
                </option>
              ))}
            </select>
            {preview && (
              <div className="rounded bg-muted/40 p-2 text-xs space-y-1">
                <div className="font-medium">{preview.name}</div>
                <div>
                  <span className="text-muted-foreground">Scena:</span> {preview.style}
                </div>
                <div>
                  <span className="text-muted-foreground">Wymagania:</span> {preview.requirements}
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              To tylko podgląd — batch analizuje każdy produkt osobno.
            </p>
          </div>

          <Collapsible open={constraintsOpen} onOpenChange={setConstraintsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 mr-1 transition-transform ${constraintsOpen ? "rotate-180" : ""}`}
                />
                Ramy projektu (opcjonalne)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <p className="text-[11px] text-muted-foreground">
                Te pola OGRANICZAJĄ dobór sceny per produkt — AI będzie się do nich stosować.
                Zostaw puste, żeby AI decydowała samodzielnie na podstawie zdjęć.
              </p>
              <div className="space-y-1">
                <Label htmlFor="viz-style" className="text-xs">Styl / stylistyka (PL, opcjonalnie)</Label>
                <Textarea
                  id="viz-style"
                  rows={2}
                  placeholder='np. "wszystkie sceny w jasnej, skandynawskiej stylistyce; bez ludzi"'
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="viz-req" className="text-xs">Wymagania (PL, opcjonalnie)</Label>
                <Textarea
                  id="viz-req"
                  rows={3}
                  placeholder="np. bez ludzi z twarzą, tylko naturalne materiały, unikaj sztucznych kolorów tła"
                  value={reqPl}
                  onChange={(e) => setReqPl(e.target.value)}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <label className="flex items-start gap-2 rounded-md border p-2 text-xs">
            <Checkbox
              checked={forceReanalyze}
              onCheckedChange={(v) => setForceReanalyze(v === true)}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium">Wymuś ponowną analizę zdjęć</div>
              <div className="text-muted-foreground">
                Zignoruje cache — użyj po zmianach zdjęć głównych/galerii. Ręczne nadpisania sceny (manual) i tak zostają.
              </div>
            </div>
          </label>

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
            Generuj (AI dobierze scenę per produkt)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}