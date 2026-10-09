export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_DIM = 1024;
const MAX_OUT_BYTES = 1024 * 1024;

export class ScanError extends Error {
  paused = false;
}

function load(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ScanError("We couldn't read that image. Try a JPEG or PNG photo."));
    };
    img.src = url;
  });
}

/** Re-encodes through a canvas: resizes, strips metadata, returns JPEG data URL <= 1MB. */
export async function compressImage(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new ScanError("That photo is over 15MB. Please choose a smaller one.");
  if (file.type && !file.type.startsWith("image/")) throw new ScanError("Please choose an image file.");
  const { img, url } = await load(file);
  try {
    const scale = Math.min(1, MAX_DIM / img.naturalWidth, MAX_DIM / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ScanError("Your browser couldn't process that photo.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let q = 0.8;
    let data = canvas.toDataURL("image/jpeg", q);
    while (data.length * 0.75 > MAX_OUT_BYTES && q > 0.3) {
      q -= 0.1;
      data = canvas.toDataURL("image/jpeg", q);
    }
    if (!data.startsWith("data:image/jpeg") || data.length * 0.75 > MAX_OUT_BYTES) {
      throw new ScanError("We couldn't shrink that photo enough. Try another one.");
    }
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function scanIngredients(image: string, mode: "fridge" | "pantry", signal: AbortSignal): Promise<string[]> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/scanIngredients`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, mode }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ScanError("Couldn't reach ScrapCook. Check your connection and try again.");
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; paused?: boolean };
    const err = new ScanError(b.message || b.error || "Scanning failed. Please try again.");
    err.paused = !!b.paused;
    throw err;
  }
  if (!Array.isArray(body)) throw new ScanError("Unexpected response from the scanner. Please try again.");
  return body.filter((x): x is string => typeof x === "string");
}
