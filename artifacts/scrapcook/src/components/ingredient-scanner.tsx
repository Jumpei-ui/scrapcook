import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { compressImage, scanIngredients, ScanError, MAX_UPLOAD_BYTES } from "@/lib/scan-image";

type Mode = "fridge" | "pantry";
export type DetectResult = { added: number; duplicates: number; skipped: number };

export default function IngredientScanner({
  onDetected,
}: {
  onDetected: (names: string[]) => DetectResult;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const cancel = useCallback(() => {
    runRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const close = useCallback(() => {
    cancel();
    setMode(null);
    setPreview((p) => { if (p) URL.revokeObjectURL(p); return null; });
    setFile(null);
    setScanning(false);
    setError("");
    triggerRef.current?.focus();
  }, [cancel]);

  useEffect(() => cancel, [cancel]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!mode) return;
    closeRef.current?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key !== "Tab") return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [mode, close]);

  const choose = (f: File | undefined) => {
    if (!f) return;
    cancel();
    setScanning(false);
    setError("");
    if (f.size > MAX_UPLOAD_BYTES || (f.type && !f.type.startsWith("image/"))) {
      setError(f.size > MAX_UPLOAD_BYTES ? "That photo is over 15MB. Please choose a smaller one." : "Please choose an image file.");
      setFile(null);
      setPreview(null);
      return;
    }
    setFile(f);
    setPreview((p) => { if (p) URL.revokeObjectURL(p); return URL.createObjectURL(f); });
  };

  const identify = async () => {
    if (!file || !mode || scanning) return;
    cancel();
    const run = runRef.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setScanning(true);
    setError("");
    try {
      const image = await compressImage(file);
      if (run !== runRef.current) return;
      const found = await scanIngredients(image, mode, ctrl.signal);
      if (run !== runRef.current) return;
      if (found.length === 0) {
        setScanning(false);
        setError("We couldn't spot any ingredients. Try a closer, brighter photo.");
        return;
      }
      const r = onDetectedRef.current(found);
      const dup = r.duplicates > 0 ? " Removed duplicates." : "";
      if (r.added > 0) {
        toast({ title: `Found ${r.added} ingredient${r.added === 1 ? "" : "s"}!${dup}`, description: r.skipped > 0 ? "Your list is full, so some items were left out." : "Review the list and remove anything that's not right." });
      } else if (r.skipped > 0) {
        toast({ title: "Your ingredient list is full", description: "Remove a few ingredients to add scanned ones.", variant: "destructive" });
      } else {
        toast({ title: "Nothing new found", description: "Everything we spotted is already in your list." });
      }
      close();
    } catch (e) {
      if (run !== runRef.current || (e instanceof DOMException && e.name === "AbortError")) return;
      setScanning(false);
      setError(e instanceof ScanError ? e.message : "Something went wrong scanning that photo. Please try again.");
    }
  };

  const label = mode === "pantry" ? "pantry" : "fridge";
  const btn = { width: "100%", justifyContent: "center" } as const;

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "nowrap" }}>
        <button type="button" className="sc-button sc-button-primary" style={{ ...btn, flex: 1, minWidth: 0, padding: "14px 8px" }}
          onClick={(e) => { triggerRef.current = e.currentTarget; setMode("fridge"); }} aria-haspopup="dialog" data-testid="button-scan-fridge">
          📸 Scan Fridge
        </button>
        <button type="button" className="sc-button sc-button-primary" style={{ ...btn, flex: 1, minWidth: 0, padding: "14px 8px" }}
          onClick={(e) => { triggerRef.current = e.currentTarget; setMode("pantry"); }} aria-haspopup="dialog" data-testid="button-scan-pantry">
          📸 Scan Pantry
        </button>
      </div>
      {mode && (
        <div className="sc-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} data-testid="dialog-scan-backdrop">
          <section ref={dialogRef} className="sc-dialog" style={{ maxHeight: "90dvh", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby="scan-title" data-testid="dialog-scan">
            <div className="sc-dialog-head">
              <div>
                <h2 id="scan-title">Scan your {label}</h2>
                <p>Take a photo or upload one and we'll list what we see.</p>
              </div>
              <button ref={closeRef} className="sc-dialog-close" type="button" onClick={close} aria-label="Close scan dialog" data-testid="button-scan-close">
                <X size={19} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              <button type="button" className="sc-button sc-button-outline" disabled={scanning} onClick={() => cameraRef.current?.click()} style={{ flex: 1, justifyContent: "center" }}>
                📸 Take Photo
              </button>
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" disabled={scanning} hidden
                  onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-scan-camera" />
              <button type="button" className="sc-button sc-button-outline" disabled={scanning} onClick={() => galleryRef.current?.click()} style={{ flex: 1, justifyContent: "center" }}>
                <ImageIcon size={16} /> Upload from Gallery
              </button>
                <input ref={galleryRef} type="file" accept="image/*" disabled={scanning} hidden
                  onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-scan-gallery" />
            </div>
            {preview && (
              <img src={preview} alt={`Your ${label} photo`} data-testid="img-scan-preview"
                style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 14, marginBottom: 14, background: "rgba(0,0,0,.05)" }} />
            )}
            {error && <p className="sc-form-error" role="alert" data-testid="status-scan-error">{error}</p>}
            <p className="sc-hint" data-testid="text-scan-privacy">
              Your photo is sent to Gemini to identify ingredients. ScrapCook doesn't store it. Please review the identified items.
            </p>
            <div className="sc-dialog-actions">
              <button type="button" className="sc-button sc-button-outline" onClick={close} data-testid="button-scan-cancel">Cancel</button>
              <button type="button" className="sc-button sc-button-primary" disabled={!file || scanning} onClick={identify} data-testid="button-identify-ingredients">
                {scanning ? <><LoaderCircle className="animate-spin" size={16} /> Scanning...</> : "Identify Ingredients"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
