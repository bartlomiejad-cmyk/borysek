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
import { Wand2, Sparkles, Loader2, ImageIcon, ChevronDown, Save, Check } from "lucide-react";
import { createBulkJob } from "@/lib/pim/bulk-jobs.functions";
import { updateProject } from "@/lib/pim/projects.functions";
import {
  suggestVisualizationField,
  suggestVisualizationPreset,
  analyzeProductImagesForPrompt,
} from "@/lib/pim/ai.functions";
import {
  BUILT_IN_PRESETS,
  legacyPreset,
  readCustomPresets,
  resolvePresetById,
  composePresetPayload,
  type ScenePreset,
} from "@/lib/pim/scene-presets";
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
  projectSettings,
}: Props) {
  const qc = useQueryClient();
  const createJob = useServerFn(createBulkJob);
  const updProject = useServerFn(updateProject);
  const suggestField = useServerFn(suggestVisualizationField);
  const suggestPreset = useServerFn(suggestVisualizationPreset);
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
  const customPresets = useMemo<ScenePreset[]>(
    () => readCustomPresets(projectSettings ?? null),
    [projectSettings],
  );
  const legacy = useMemo(
    () => legacyPreset(defaultStylePrompt, defaultRequirementsPl),
    [defaultStylePrompt, defaultRequirementsPl],
  );
  const availablePresets = useMemo<ScenePreset[]>(
    () => [
      ...(legacy ? [legacy] : []),
      ...customPresets,
      ...BUILT_IN_PRESETS,
    ],
    [customPresets, legacy],
  );
  const initialPresetId = legacy ? legacy.id : BUILT_IN_PRESETS[0]!.id;
  const [presetId, setPresetId] = useState<string>(initialPresetId);
  const [adjustments, setAdjustments] = useState<string>("");
  const [customOpen, setCustomOpen] = useState(false);
  const [style, setStyle] = useState<string>("");
  const [reqPl, setReqPl] = useState<string>("");
  const [quality, setQuality] = useState<"2K" | "4K">("2K");
  const [busy, setBusy] = useState(false);
  const [busyStyle, setBusyStyle] = useState(false);
  const [busyReq, setBusyReq] = useState(false);
  const [busyVision, setBusyVision] = useState(false);
  const [busyMatch, setBusyMatch] = useState(false);
  const [busySave, setBusySave] = useState(false);
  const [presetName, setPresetName] = useState("");

  const selectedPreset = useMemo<ScenePreset | null>(
    () => resolvePresetById(presetId, [...(legacy ? [legacy] : []), ...customPresets]),
    [presetId, legacy, customPresets],
  );

  // When user opens Dostosuj, prefill the two text fields from the preset so
  // they can tweak in Polish. Style comes from style_en (which is the EN scene
  // description we pass into buildFalPromptsFromPolish); requirements come
  // from requirements_en. Legacy preset already holds the original PL text.
  useEffect(() => {
    if (!open) return;
    if (!selectedPreset) return;
    setStyle(selectedPreset.style_en);
    setReqPl(selectedPreset.requirements_en);
  }, [open, selectedPreset]);

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

  const matchPreset = async () => {
    setBusyMatch(true);
    try {
      const out = await suggestPreset({ data: { projectId } });
      setPresetId(out.preset_id);
      setAdjustments(out.adjustments ?? "");
      toast.success("AI dobrała preset");
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się dopasować presetu"));
    } finally {
      setBusyMatch(false);
    }
  };

  const analyzeFromImages = async () => {
    const withMain = selectedTargets.filter(hasMain);
    const pick = withMain[0] ?? withMainTargets[0];
    if (!pick) {
      toast.info("Zaznacz produkt ze zdjęciem, aby AI mogła je przeanalizować");
      return;
    }
    setBusyVision(true);
    try {
      const out = await analyzeImagesFn({
        data: { productId: pick.id, mode: "visualization" },
      });
      // Vision output is treated as per-product personalisation ON TOP of the
      // chosen preset. Preset rules take precedence on conflicts; we simply
      // concatenate the vision insight into the `adjustments` field.
      const merged = [adjustments.trim(), out.requirements.trim(), out.style.trim()]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 480);
      setAdjustments(merged);
      toast.success(`AI przeanalizowała ${out.analyzed} zdjęcie/zdjęć`);
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się przeanalizować zdjęć"));
    } finally {
      setBusyVision(false);
    }
  };

  // Re-sync scope + preset defaults when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setScope(selectedIds.size > 0 ? "selected" : "with_main");
    setPresetId(legacy ? legacy.id : BUILT_IN_PRESETS[0]!.id);
    setAdjustments("");
    setCustomOpen(false);
  }, [open, selectedIds, legacy]);

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) {
      toast.info("Nadaj nazwę presetowi");
      return;
    }
    const s = style.trim();
    const r = reqPl.trim();
    if (!s && !r) {
      toast.info("Uzupełnij pola stylu lub wymagań przed zapisem");
      return;
    }
    setBusySave(true);
    try {
      const existing = readCustomPresets(projectSettings ?? null);
      const id = `custom_${Date.now().toString(36)}`;
      const nextArr = [
        ...existing,
        {
          id,
          label_pl: name,
          thumbnail_hint: "Własny preset projektu.",
          style_en: s,
          requirements_en: r,
        },
      ];
      const nextSettings = {
        ...(projectSettings ?? {}),
        scene_presets: nextArr,
      } as Record<string, unknown>;
      await updProject({ data: { id: projectId, settings: nextSettings } });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Preset zapisany w projekcie");
      setPresetName("");
      setPresetId(id);
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się zapisać presetu"));
    } finally {
      setBusySave(false);
    }
  };

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
    if (!selectedPreset) {
      toast.info("Wybierz preset sceny");
      return;
    }
    setBusy(true);
    try {
      // If the user edited the collapsible text fields we honour those exact
      // values; otherwise we compose the payload from the preset + AI-picked
      // per-product adjustments. Preset preservation rules always apply.
      const usingCustomText = customOpen &&
        (style.trim() !== selectedPreset.style_en.trim() ||
          reqPl.trim() !== selectedPreset.requirements_en.trim());
      const payload = usingCustomText
        ? { stylePrompt: style.trim(), requirementsPl: reqPl.trim() }
        : composePresetPayload(selectedPreset, adjustments);

      // Persist last-used defaults on the project so users don't retype them.
      await updProject({
        data: {
          id: projectId,
          visualization_style_prompt: payload.stylePrompt || null,
          visualization_requirements_pl: payload.requirementsPl || null,
        },
      });
      await createJob({
        data: {
          projectId,
          kind: "PIM_VISUALIZATIONS",
          items: targets.map((t) => t.id),
          payload: {
            count,
            stylePrompt: payload.stylePrompt,
            requirementsPl: payload.requirementsPl,
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
          <div className="flex items-center justify-between gap-2 rounded-md border border-violet-200 bg-violet-50/50 dark:bg-violet-950/20 p-2">
            <div className="text-xs">
              <div className="font-medium">Spersonalizuj na podstawie zdjęć</div>
              <div className="text-muted-foreground">
                Gemini przegląda zdjęcia pierwszego produktu i dokłada wskazówki do wybranego presetu.
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={analyzeFromImages}
              disabled={busyVision || busy}
            >
              {busyVision ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
              )}
              Analizuj zdjęcia
            </Button>
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

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Preset sceny</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={matchPreset}
                disabled={busyMatch || busy}
              >
                {busyMatch ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Dobierz AI
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {availablePresets.map((p) => {
                const active = presetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPresetId(p.id)}
                    className={`text-left rounded-md border p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/60 ${
                      active
                        ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
                        : "border-border hover:border-violet-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{p.label_pl}</div>
                      {active && <Check className="h-3.5 w-3.5 text-violet-600" />}
                    </div>
                    <div className="text-[11px] text-muted-foreground line-clamp-2">
                      {p.thumbnail_hint}
                    </div>
                    {p.custom && (
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-violet-700 dark:text-violet-300">
                        {p.id === "__legacy_custom__" ? "Dotychczasowe" : "Preset projektu"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="space-y-1 pt-1">
              <Label htmlFor="viz-adjust" className="text-xs">
                Dostosowanie dla tego projektu (PL, opcjonalnie)
              </Label>
              <Textarea
                id="viz-adjust"
                rows={2}
                placeholder="np. dodaj świeże liście i drewnianą deskę wokół produktu"
                value={adjustments}
                onChange={(e) => setAdjustments(e.target.value.slice(0, 480))}
              />
              <p className="text-[11px] text-muted-foreground">
                Zasady zachowania koloru, logo i proporcji produktu są nadrzędne — nie zostaną zmienione.
              </p>
            </div>
          </div>

          <Collapsible open={customOpen} onOpenChange={setCustomOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 mr-1 transition-transform ${customOpen ? "rotate-180" : ""}`}
                />
                Dostosuj (edytuj prompt ręcznie)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="viz-style">Styl / scena (EN)</Label>
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
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="viz-req">Wymagania techniczne (EN/PL)</Label>
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
                  value={reqPl}
                  onChange={(e) => setReqPl(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 rounded-md border border-dashed p-2">
                <Input
                  placeholder="Nazwa presetu (np. Sklep narzędziowy)"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="flex-1 h-8 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={savePreset}
                  disabled={busySave || busy}
                >
                  {busySave ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Zapisz jako preset projektu
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

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