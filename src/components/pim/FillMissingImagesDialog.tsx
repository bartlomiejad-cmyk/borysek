import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { createBulkJob } from "@/lib/pim/bulk-jobs.functions";
import { startFirecrawlDiscovery } from "@/lib/pim/firecrawl.functions";
import { friendlyError } from "@/lib/utils";

export type FillTarget = {
  id: string;
  picked_urls?: string[];
  thumbnail?: string | null;
  regenerated_main_image?: string | null;
  ai_gallery_urls?: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  targets: FillTarget[];
};

export function FillMissingImagesDialog({ open, onOpenChange, projectId, targets }: Props) {
  const qc = useQueryClient();
  const startDiscovery = useServerFn(startFirecrawlDiscovery);
  const createJob = useServerFn(createBulkJob);

  const missingSources = useMemo(
    () => targets.filter((t) => !(t.picked_urls && t.picked_urls.length > 0)),
    [targets],
  );
  const missingMedia = useMemo(
    () =>
      targets.filter(
        (t) =>
          !t.regenerated_main_image &&
          !(t.ai_gallery_urls && t.ai_gallery_urls.length > 0) &&
          !t.thumbnail,
      ),
    [targets],
  );

  const [doScrape, setDoScrape] = useState(true);
  const [doRegen, setDoRegen] = useState(true);
  const [gallery, setGallery] = useState(5);
  const [quality, setQuality] = useState<"2K" | "4K">("2K");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!doScrape && !doRegen) {
      toast.info("Zaznacz co najmniej jedną akcję");
      return;
    }
    setBusy(true);
    try {
      if (doScrape && missingSources.length) {
        await startDiscovery({
          data: {
            projectId,
            onlyMissing: true,
            productIds: missingSources.map((t) => t.id),
          },
        });
        qc.invalidateQueries({ queryKey: ["project", projectId, "bulk-job", "FIRECRAWL_DISCOVERY"] });
        toast.success(`Scrape uruchomiony: ${missingSources.length} produktów`);
      }
      if (doRegen) {
        const regenIds = missingMedia.length ? missingMedia.map((t) => t.id) : targets.map((t) => t.id);
        if (!regenIds.length) {
          toast.info("Brak produktów do regeneracji");
        } else {
          await createJob({
            data: {
              projectId,
              kind: "REGENERATE_MEDIA",
              items: regenIds,
              payload: {
                maxGallery: gallery,
                targetResolution: quality === "4K" ? 4096 : 2048,
              },
            },
          });
          qc.invalidateQueries({ queryKey: ["project", projectId, "bulk-job", "REGENERATE_MEDIA"] });
          toast.success(`Regeneracja uruchomiona: ${regenIds.length} produktów`);
        }
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(friendlyError(e, "Nie udało się uruchomić zadania"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Uzupełnij zdjęcia</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Zaznaczono <b>{targets.length}</b> produktów: <b>{missingSources.length}</b> bez źródeł,{" "}
            <b>{missingMedia.length}</b> bez wygenerowanych mediów.
          </div>

          <label className="flex items-start gap-2">
            <Checkbox checked={doScrape} onCheckedChange={(v) => setDoScrape(!!v)} />
            <div>
              <div className="text-sm font-medium">Doscrapuj brakujące źródła (Firecrawl)</div>
              <div className="text-xs text-muted-foreground">
                Uruchamia wyszukiwanie tylko dla produktów bez wybranych źródeł ({missingSources.length}).
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2">
            <Checkbox checked={doRegen} onCheckedChange={(v) => setDoRegen(!!v)} />
            <div>
              <div className="text-sm font-medium">Regeneruj media (FAL)</div>
              <div className="text-xs text-muted-foreground">
                {missingMedia.length
                  ? `Zregeneruje ${missingMedia.length} produktów bez zdjęć.`
                  : `Wszystkie zaznaczone mają już media — regeneracja obejmie ${targets.length} produktów.`}
              </div>
            </div>
          </label>

          <div className={doRegen ? "space-y-3" : "space-y-3 opacity-50 pointer-events-none"}>
            <div className="space-y-1">
              <Label htmlFor="gallery-count">Liczba wizualizacji (galeria)</Label>
              <Input
                id="gallery-count"
                type="number"
                min={0}
                max={8}
                value={gallery}
                onChange={(e) => setGallery(Math.max(0, Math.min(8, Number(e.target.value) || 0)))}
                className="w-24"
              />
            </div>
            <div className="space-y-1">
              <Label>Jakość</Label>
              <RadioGroup
                value={quality}
                onValueChange={(v) => setQuality(v as "2K" | "4K")}
                className="flex gap-4"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="2K" /> 2K (social)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="4K" /> 4K (e-commerce)
                </label>
              </RadioGroup>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Anuluj
          </Button>
          <Button onClick={run} disabled={busy}>
            Uruchom
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}