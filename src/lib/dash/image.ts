/** Browser-only: shrinks a photo to at most 1600 px on the long side and re-encodes it as WebP (usually well under 300 KB). */
export const MAX_SIDE = 1600;

export function fitWithin(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export async function compressToWebp(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP photo.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This photo could not be opened. Please try a JPG or PNG.');
  });
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize photos.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const q of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', q));
    if (blob && blob.size <= 1.8 * 1024 * 1024) return blob;
  }
  throw new Error('This photo is still too large after shrinking. Please choose a smaller one.');
}
