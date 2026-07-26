import { PNG } from "pngjs";

// Image models here have no reliable "transparent background" option (tested: they either
// ignore it or literally paint a fake checkerboard pattern). Instead we ask the model for a
// solid chroma-key background and cut it out ourselves.
export const CHROMA_KEY_COLOR = { r: 255, g: 0, b: 255 } as const; // pure magenta
const COLOR_TOLERANCE = 60;
const FEATHER_RANGE = 40;
const MAX_DIMENSION = 480;

function colorDistance(r: number, g: number, b: number): number {
  const { r: kr, g: kg, b: kb } = CHROMA_KEY_COLOR;
  return Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2);
}

/** Removes the chroma-key background via flood fill from the image border, so a stray
 *  key-colored patch inside the character itself is never touched — only the connected
 *  background region is. Edge pixels get a soft alpha falloff instead of a hard cutout. */
function cutoutChromaKey(png: PNG): void {
  const { width, height, data } = png;
  const total = width * height;
  const isBackground = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qTail = 0;

  const pixelDistance = (i: number) => {
    const o = i * 4;
    return colorDistance(data[o], data[o + 1], data[o + 2]);
  };

  const tryEnqueue = (i: number) => {
    if (visited[i]) return;
    visited[i] = 1;
    if (pixelDistance(i) <= COLOR_TOLERANCE) {
      isBackground[i] = 1;
      queue[qTail++] = i;
    }
  };

  for (let x = 0; x < width; x++) {
    tryEnqueue(x);
    tryEnqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    tryEnqueue(y * width);
    tryEnqueue(y * width + (width - 1));
  }

  for (let qHead = 0; qHead < qTail; qHead++) {
    const i = queue[qHead];
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) tryEnqueue(i - 1);
    if (x < width - 1) tryEnqueue(i + 1);
    if (y > 0) tryEnqueue(i - width);
    if (y < height - 1) tryEnqueue(i + width);
  }

  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (isBackground[i]) {
      data[o + 3] = 0;
      continue;
    }
    const dist = pixelDistance(i);
    if (dist < COLOR_TOLERANCE + FEATHER_RANGE) {
      const t = Math.max(0, Math.min(1, (dist - COLOR_TOLERANCE) / FEATHER_RANGE));
      data[o + 3] = Math.round(data[o + 3] * t);
    }
  }
}

/** Alpha-weighted box downsample so cut-out edges don't pick up color from fully-transparent
 *  neighbors, keeping the stored data URL small (the source is generated at ~2048px). */
function boxDownsample(png: PNG, maxDimension: number): PNG {
  const { width: srcW, height: srcH, data: src } = png;
  const scale = maxDimension / Math.max(srcW, srcH);
  if (scale >= 1) return png;

  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));
  const out = new PNG({ width: dstW, height: dstH });
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor(dy * yRatio);
    const sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) * yRatio));
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor(dx * xRatio);
      const sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) * xRatio));
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const idx = (sy * srcW + sx) * 4;
          const a = src[idx + 3];
          rSum += src[idx] * a;
          gSum += src[idx + 1] * a;
          bSum += src[idx + 2] * a;
          aSum += a;
          count++;
        }
      }
      const dstIdx = (dy * dstW + dx) * 4;
      if (aSum > 0) {
        out.data[dstIdx] = Math.round(rSum / aSum);
        out.data[dstIdx + 1] = Math.round(gSum / aSum);
        out.data[dstIdx + 2] = Math.round(bSum / aSum);
      }
      out.data[dstIdx + 3] = Math.round(aSum / count);
    }
  }
  return out;
}

function toDataUrl(png: PNG): string {
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

/** Fetches a freshly generated (chroma-key background) image and returns the transparent-PNG
 *  cutout for `pets.avatar_url` — what the player actually sees.
 *
 *  This used to also return a second, magenta-background copy as a data URL, stored in
 *  `avatar_source_url` to serve as the image-to-image reference for a later evolution edit.
 *  That could never work: the generation API rejects `data:` URIs outright
 *  ("400 BAD_REQUEST: File type not supported"), so every evolution edit threw and pets simply
 *  never changed. The reference is now the generated image's own https URL — which the API does
 *  accept — and that also keeps ~380KB of base64 per pet out of the database. */
export async function processAvatarImage(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`failed to fetch generated image: ${res.status} ${imageUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const cutout = PNG.sync.read(buf);
  cutoutChromaKey(cutout);
  return toDataUrl(boxDownsample(cutout, MAX_DIMENSION));
}
