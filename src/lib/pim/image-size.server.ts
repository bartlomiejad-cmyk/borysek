// Lightweight server-side image dimension probe.
// Fetches first ~64KB of each URL (Range request, falls back to full GET if
// the server ignores Range) and parses width/height from the format header.
// Supported: JPEG (SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15),
// PNG (IHDR), WebP (VP8, VP8L, VP8X), GIF.

export type Dim = { w: number; h: number };

export async function probeImageSize(url: string, timeoutMs = 8000): Promise<Dim | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    const uaHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/*,*/*;q=0.8",
    };
    try {
      res = await fetch(url, { headers: { ...uaHeaders, Range: "bytes=0-65535" }, signal: ctrl.signal });
      if (!res.ok && res.status !== 206) {
        res = await fetch(url, { headers: uaHeaders, signal: ctrl.signal });
      }
    } finally {
      clearTimeout(t);
    }
    if (!res.ok && res.status !== 206) return null;
    // Hotlink-protected shops often return HTML with 200; reject non-image
    // content-types so the caller can mark the URL dead.
    const ct = res.headers.get("content-type");
    if (ct && !ct.toLowerCase().startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return parse(buf);
  } catch {
    return null;
  }
}

export async function probeManySizes(
  urls: string[],
  concurrency = 6,
): Promise<Record<string, Dim>> {
  const out: Record<string, Dim> = {};
  const queue = [...urls];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const u = queue.shift();
      if (!u) break;
      const dim = await probeImageSize(u);
      if (dim) out[u] = dim;
    }
  });
  await Promise.all(workers);
  return out;
}

function parse(b: Uint8Array): Dim | null {
  if (b.length < 8) return null;
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    if (b.length < 24) return null;
    const w = readU32BE(b, 16);
    const h = readU32BE(b, 20);
    return { w, h };
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    if (b.length < 10) return null;
    const w = b[6] | (b[7] << 8);
    const h = b[8] | (b[9] << 8);
    return { w, h };
  }
  // WebP — RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8 " && b.length >= 30) {
      const w = (b[26] | (b[27] << 8)) & 0x3fff;
      const h = (b[28] | (b[29] << 8)) & 0x3fff;
      return { w, h };
    }
    if (fourcc === "VP8L" && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >>> 14) & 0x3fff) + 1;
      return { w, h };
    }
    if (fourcc === "VP8X" && b.length >= 30) {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { w, h };
    }
  }
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null;
      // skip fill bytes
      while (i < b.length && b[i] === 0xff) i++;
      const marker = b[i++];
      // standalone markers without payload
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      if (i + 1 >= b.length) return null;
      const segLen = (b[i] << 8) | b[i + 1];
      // SOFn markers carrying dimensions
      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSOF) {
        if (i + 7 >= b.length) return null;
        const h = (b[i + 3] << 8) | b[i + 4];
        const w = (b[i + 5] << 8) | b[i + 6];
        return { w, h };
      }
      i += segLen;
    }
    return null;
  }
  return null;
}

function readU32BE(b: Uint8Array, o: number): number {
  return (b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
}
