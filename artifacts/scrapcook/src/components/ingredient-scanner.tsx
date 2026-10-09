import { useCallback, useEffect, useRef, useState } from "react";
import { Check, HelpCircle, Image as ImageIcon, LoaderCircle, Pencil, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { compressImage, scanIngredients, ScanError, MAX_UPLOAD_BYTES } from "@/lib/scan-image";
import type { ScanItem, ScanResult } from "@/lib/scan-image";

export type { ScanItem, ScanResult };
type Row = ScanItem & { id: number; selected: boolean; editing: boolean; draft: string };
const norm = (v: string) => v.trim().toLowerCase();
const QUALITY: Record<string, string> = {
  blurry: "Image is blurry, results may be off",
  dark: "Image is dark, results may be off",
  dark_and_blurry: "Image is dark and blurry, results may be off",
};

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
  const [result, setResult] = useState<ScanResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [helpItem, setHelpItem] = useState<number | null>(null);
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
    setResult(null);
    setRows([]);
    setHelpItem(null);
    triggerRef.current?.focus();
  }, [cancel]);

  useEffect(() => cancel, [cancel]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!mode) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key !== "Tab") return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]):not([hidden])");
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

  const stage = result ? (result.items.length ? "review" : "empty") : "input";
  useEffect(() => { if (mode) closeRef.current?.focus(); }, [mode, stage]);

  const update = (id: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const retake = () => { cancel(); setResult(null); setRows([]); setHelpItem(null); setFile(null); setError(""); setPreview((p) => { if (p) URL.revokeObjectURL(p); return null; }); };
  const valid = (r: Row) => { const n = norm(r.editing ? r.draft : r.name); return n.length > 0 && n.length <= 30; };
  const chosen = rows.filter((r) => r.selected);
  const canAdd = chosen.length > 0 && rows.every((r) => !r.editing) && chosen.every(valid);
  const saveEdit = (r: Row) => {
    const n = norm(r.draft);
    if (!n || n.length > 30) return;
    update(r.id, { name: n, editing: false });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="button-edit-item-${r.id}"]`)?.focus());
  };
  const confirm = () => {
    if (!canAdd) return;
    const r = onDetectedRef.current(chosen.map((x) => norm(x.name)));
    const dup = r.duplicates > 0 ? " Removed duplicates." : "";
    if (r.added > 0) toast({ title: `Added ${r.added} ingredient${r.added === 1 ? "" : "s"}!${dup}`, description: r.skipped > 0 ? "Your list is full, so some items were left out." : undefined });
    else if (r.skipped > 0) toast({ title: "Your ingredient list is full", description: "Remove a few ingredients to add scanned ones.", variant: "destructive" });
    else toast({ title: "Nothing new found", description: "Everything selected is already in your list." });
    close();
  };

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
      setScanning(false);
      setRows(found.items.map((it, i) => ({ ...it, name: norm(it.name), id: i, selected: it.confidence !== "low", editing: false, draft: norm(it.name) })));
      setResult(found);
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
                <h2 id="scan-title" data-testid={stage === "input" ? undefined : "text-scan-result-title"}>{stage === "input" ? `Scan your ${label}` : "📸 Scan Result"}</h2>
                <p>Take a photo or upload one and we'll list what we see.</p>
              </div>
              <button ref={closeRef} className="sc-dialog-close" type="button" onClick={close} aria-label="Close scan dialog" data-testid="button-scan-close">
                <X size={19} />
              </button>
            </div>
            {stage === "input" && (
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
            )}
            {result && QUALITY[result.imageQuality] && <p className="sc-form-error" role="alert" data-testid="status-scan-quality">{QUALITY[result.imageQuality]}</p>}
            {preview && (
              <img src={preview} alt={`Your ${label} photo`} data-testid="img-scan-preview"
                style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 14, marginBottom: 14, background: "rgba(0,0,0,.05)", opacity: stage === "input" ? 1 : 0.55 }} />
            )}
            {stage !== "input" && result && (
              <div data-testid="stage-scan-review">
                {stage === "empty" ? (
                  <>
                    <p data-testid="text-scan-empty">Couldn't spot anything clear, try closer photo or better light</p>
                    <button type="button" className="sc-button sc-button-primary" onClick={retake} data-testid="button-scan-retake">Retake</button>
                  </>
                ) : (
                  <>
                    <p data-testid="text-scan-found">Found {rows.length} item{rows.length === 1 ? "" : "s"} - tap to keep</p>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                      <button type="button" className="sc-button sc-button-outline" data-testid="button-scan-select-all"
                        onClick={() => setRows((r) => r.map((x) => ({ ...x, selected: true })))}>
                        Select All
                      </button>
                      <button type="button" className="sc-button sc-button-outline" data-testid="button-scan-deselect-all"
                        onClick={() => setRows((r) => r.map((x) => ({ ...x, selected: false })))}>
                        Deselect All
                      </button>
                      <button type="button" className="sc-button sc-button-outline" onClick={retake} data-testid="button-scan-retake">Retake</button>
                    </div>
                    <div className="sc-tags" style={{ marginBottom: 14 }}>
                      {rows.map((r) => (
                        <span key={r.id} className="sc-tag" data-testid={`chip-scan-item-${r.id}`}
                          style={{ opacity: r.selected ? 1 : 0.6, borderColor: r.confidence === "low" ? "#d4a017" : r.selected && r.confidence === "high" ? "var(--sc-green)" : undefined, borderWidth: 2, borderStyle: "solid", display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", flexWrap: "wrap" }}>
                          {r.editing ? (
                            <>
                              <label className="sr-only" htmlFor={`scan-edit-${r.id}`} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Edit name for {r.name}</label>
                              <input id={`scan-edit-${r.id}`} autoFocus value={r.draft} maxLength={30} data-testid={`input-edit-item-${r.id}`} style={{ width: 120 }}
                                onChange={(e) => update(r.id, { draft: e.target.value })}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit(r); } if (e.key === "Escape") { e.stopPropagation(); update(r.id, { editing: false, draft: r.name }); } }} />
                              <button type="button" aria-label={`Save name for ${r.name}`} disabled={!valid(r)} onClick={() => saveEdit(r)} data-testid={`button-save-item-${r.id}`}><Check size={13} /></button>
                              <button type="button" aria-label="Cancel editing" onClick={() => update(r.id, { editing: false, draft: r.name })} data-testid={`button-cancel-item-${r.id}`}><X size={13} /></button>
                            </>
                          ) : (
                            <>
                              <button type="button" aria-pressed={r.selected} data-testid={`button-toggle-item-${r.id}`} title={r.location}
                                onClick={() => update(r.id, { selected: !r.selected })} style={{ display: "inline-flex", alignItems: "center", gap: 4, width: "auto", height: "auto", minWidth: 0, maxWidth: "100%", padding: "4px", borderRadius: 8, whiteSpace: "normal", textAlign: "left", overflowWrap: "anywhere" }}>
                                {r.selected && <Check size={13} color="var(--sc-green)" aria-label="Selected" style={{ flexShrink: 0 }} />}
                                {!r.selected && <span aria-hidden="true" style={{ width: 13, height: 13, border: "1px solid currentColor", borderRadius: 3, flexShrink: 0 }} />}
                                <span>{r.name}{r.location && <small style={{ display: "block" }}>({r.location})</small>}
                                  <small data-testid={`text-confidence-${r.id}`} style={{ display: "block" }}>{r.confidence} confidence</small>
                                </span>
                              </button>
                              {r.confidence === "medium" && <>
                                <button type="button" title="Not sure about this one - please review" aria-label={`Why review ${r.name}?`}
                                  aria-expanded={helpItem === r.id} aria-describedby={helpItem === r.id ? `scan-help-${r.id}` : undefined}
                                  onClick={() => setHelpItem(helpItem === r.id ? null : r.id)} data-testid={`tooltip-medium-${r.id}`}><HelpCircle size={13} /></button>
                                {helpItem === r.id && <small role="tooltip" id={`scan-help-${r.id}`} style={{ whiteSpace: "normal" }}>Not sure about this one - please review.</small>}
                              </>}
                              <button type="button" aria-label={`Edit ${r.name}`} data-testid={`button-edit-item-${r.id}`}
                                onClick={(e) => { e.stopPropagation(); update(r.id, { editing: true, draft: r.name }); }}><Pencil size={13} /></button>
                            </>
                          )}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {error && <p className="sc-form-error" role="alert" data-testid="status-scan-error">{error}</p>}
            <p className="sc-hint" data-testid="text-scan-privacy">
              Your photo is sent to Gemini to identify ingredients. ScrapCook doesn't store it. Please review the identified items.
            </p>
            <div className="sc-dialog-actions">
              <button type="button" className="sc-button sc-button-outline" onClick={close} data-testid="button-scan-cancel">Cancel</button>
              {stage === "input" && (
              <button type="button" className="sc-button sc-button-primary" disabled={!file || scanning} onClick={identify} data-testid="button-identify-ingredients">
                {scanning ? <><LoaderCircle className="animate-spin" size={16} /> Scanning...</> : "Identify Ingredients"}
              </button>)}
              {stage === "review" && (
              <button type="button" className="sc-button sc-button-primary" disabled={!canAdd} onClick={confirm} data-testid="button-scan-confirm" aria-live="polite">
                Add {chosen.length} Selected to Ingredients
              </button>)}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
