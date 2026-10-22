'use client';
import { btnPrimary } from '@/components/guest/ui';

export function PrintButton() {
  return (
    <button type="button" className={btnPrimary} onClick={() => window.print()}>
      Print
    </button>
  );
}
