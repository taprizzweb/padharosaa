/** Pure maths for the image cropper: no browser needed, so it can be unit-tested. */
export interface CropView { frameW: number; frameH: number; imgW: number; imgH: number; zoom: number; cx: number; cy: number }

/** Pixels the image is scaled by on screen: "cover" the frame, then the zoom on top. */
export const scaleOf = (v: Pick<CropView, 'frameW' | 'frameH' | 'imgW' | 'imgH' | 'zoom'>): number =>
  Math.max(v.frameW / v.imgW, v.frameH / v.imgH) * v.zoom;

/** Keeps the frame fully inside the picture: (cx, cy) is the picture point shown at the middle of the frame. */
export function clampCenter(v: CropView): { cx: number; cy: number } {
  const s = scaleOf(v);
  const halfW = v.frameW / s / 2;
  const halfH = v.frameH / s / 2;
  return {
    cx: Math.min(v.imgW - halfW, Math.max(halfW, v.cx)),
    cy: Math.min(v.imgH - halfH, Math.max(halfH, v.cy)),
  };
}

/** The part of the original picture (in its own pixels) that is inside the frame. */
export function sourceRect(v: CropView): { sx: number; sy: number; sw: number; sh: number } {
  const s = scaleOf(v);
  const { cx, cy } = clampCenter(v);
  const sw = v.frameW / s;
  const sh = v.frameH / s;
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}
