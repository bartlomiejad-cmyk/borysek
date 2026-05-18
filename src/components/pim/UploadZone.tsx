import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  accept: string;
  description: string;
  count?: number;
  onFile: (file: File) => Promise<void>;
};

export function UploadZone({ title, accept, description, count, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const handle = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setProgress("Parsowanie...");
    try {
      await onFile(file);
      setProgress(null);
    } catch (e) {
      setProgress(e instanceof Error ? e.message : "Błąd");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            {count !== undefined && count > 0 ? (
              <FileCheck className="h-4 w-4 text-green-600" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {title}
          </h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {count !== undefined && (
          <span className="text-xs text-muted-foreground">{count} wierszy</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0] ?? null)}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={cn("w-full", busy && "opacity-70")}
      >
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
        {busy ? progress ?? "Wczytywanie..." : "Wybierz plik"}
      </Button>
      {!busy && progress && <p className="text-xs text-destructive mt-2">{progress}</p>}
    </div>
  );
}