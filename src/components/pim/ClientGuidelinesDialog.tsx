import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateClientGuidelines } from "@/lib/pim/products.functions";

export function ClientGuidelinesDialog({
  open,
  onOpenChange,
  projectId,
  initialValue,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  initialValue: string;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(updateClientGuidelines);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const mut = useMutation({
    mutationFn: (v: string) => saveFn({ data: { projectId, guidelines: v } }),
    onSuccess: () => {
      toast.success("Wytyczne klienta zapisane");
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Nie udało się zapisać"),
  });

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen && value.trim() !== initialValue.trim()) {
      mut.mutate(value);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Wytyczne klienta</DialogTitle>
          <DialogDescription>
            Ustalenia z klientem (tone of voice, wymagane pola, frazy zakazane, styl wizualny).
            Będą automatycznie dołączane do wszystkich promptów AI w tym projekcie. Nie są widoczne
            w linkach do udostępnienia ani w podglądzie dla klienta.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={12}
          placeholder={
            "Np.:\n- Ton neutralny, katalogowy, bez emoji.\n- Zawsze wymieniaj pojemność w litrach.\n- Zakazane frazy: „idealny wybór”, „rewolucyjny”.\n- Styl wizualny: minimalizm, jasne drewno w tle."
          }
          maxLength={4000}
        />
        <div className="flex justify-between items-center gap-2 pt-2">
          <div className="text-xs text-muted-foreground">{value.length} / 4000</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Anuluj</Button>
            <Button
              onClick={() => {
                mut.mutate(value);
                onOpenChange(false);
              }}
              disabled={mut.isPending}
            >
              Zapisz
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}