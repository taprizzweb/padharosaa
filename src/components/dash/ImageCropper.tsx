'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Sheet, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { clampCenter, scaleOf, sourceRect } from '@/lib/dash/crop';

/**
 * Pick the visible part of a photo: drag it, zoom with the slider (or arrow keys / +/- when the frame is focused).
 * The result is cropped to the chosen shape and saved as a WebP no larger than `outWidth` pixels wide.
 */
export function ImageCropper({ file, aspect, outWidth, title, onCancel, onDone }: {
  file: File; aspect: number; outWidth: number; title: string; onCancel: () => void; onDone: (blob: Blob) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [frameW, setFrameW] = useState(320);
  const [zoom, setZoom] = useState(1);
  const [c, setC] = useState({ cx: 0, cy: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const frameH = frameW / aspect;

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    const img = new Image();
    img.onload = () => { setSize({ w: img.naturalWidth, h: img.naturalHeight }); setC({ cx: img.naturalWidth / 2, cy: img.naturalHeight / 2 }); };
    img.onerror = () => setErr('This photo could not be opened. Please try a JPG or PNG.');
    img.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth || 320));
    ro.observe(el);
    return () => ro.disconnect();
  }, [url]);

  const view = useMemo(() => (size ? { frameW, frameH, imgW: size.w, imgH: size.h, zoom, cx: c.cx, cy: c.cy } : null), [size, frameW, frameH, zoom, c]);
  const placed = view ? { ...view, ...clampCenter(view) } : null;
  const s = placed ? scaleOf(placed) : 1;

  const move = (dx: number, dy: number) => {
    if (!placed) return;
    setC(clampCenter({ ...placed, cx: placed.cx - dx / s, cy: placed.cy - dy / s }));
  };
  const changeZoom = (z: number) => {
    const nz = Math.min(4, Math.max(1, z));
    setZoom(nz);
    if (placed) setC(clampCenter({ ...placed, zoom: nz }));
  };

  async function confirm() {
    if (!placed || !url) return;
    setBusy(true); setErr(null);
    try {
      const bitmap = await createImageBitmap(file);
      const { sx, sy, sw, sh } = sourceRect(placed);
      const w = Math.min(outWidth, Math.round(sw));
      const h = Math.round(w / aspect);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser cannot crop photos.');
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
      bitmap.close();
      for (const q of [0.84, 0.72, 0.58]) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', q));
        if (blob && blob.size <= 1.8 * 1024 * 1024) return onDone(blob);
      }
      throw new Error('This photo is still too large. Please choose a smaller one.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The photo could not be cropped.');
    } finally { setBusy(false); }
  }

  return (
    <Sheet open onClose={onCancel} title={title} closeLabel="Close">
      <div className="space-y-4">
        <p className="text-sm text-stone-700">Drag the photo to choose what shows. Use the slider to zoom in.</p>
        <div
          ref={frameRef}
          role="group"
          tabIndex={0}
          aria-label="Crop area. Use the arrow keys to move the photo and plus or minus to zoom."
          className="relative w-full touch-none select-none overflow-hidden rounded-xl bg-stone-200"
          style={{ aspectRatio: String(aspect), cursor: 'grab' }}
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!drag.current) return; move(e.clientX - drag.current.x, e.clientY - drag.current.y); drag.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onKeyDown={(e) => {
            const step = 24;
            if (e.key === 'ArrowLeft') { e.preventDefault(); move(step, 0); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); move(-step, 0); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(0, step); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(0, -step); }
            else if (e.key === '+' || e.key === '=') { e.preventDefault(); changeZoom(zoom + 0.2); }
            else if (e.key === '-') { e.preventDefault(); changeZoom(zoom - 0.2); }
          }}
        >
          {url && placed && (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
            <img src={url} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ width: placed.imgW * s, height: placed.imgH * s, left: frameW / 2 - placed.cx * s, top: frameH / 2 - placed.cy * s }} />
          )}
          <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-60">
            {Array.from({ length: 9 }, (_, i) => <span key={i} className="border border-white/50" />)}
          </div>
        </div>
        <label className="block text-sm font-semibold">Zoom
          <input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} className="mt-1 block h-11 w-full" />
        </label>
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2">
          <button type="button" className={`${btnSecondary} flex-1`} onClick={onCancel}>Cancel</button>
          <button type="button" className={`${btnPrimary} flex-1`} disabled={!placed || busy} onClick={() => void confirm()}>{busy ? 'Saving…' : 'Use this crop'}</button>
        </div>
      </div>
    </Sheet>
  );
}
