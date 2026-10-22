export const PAY_MODES = ['cash', 'upi', 'card'] as const;
export type PayMode = (typeof PAY_MODES)[number];

/** What the staff member must physically bring to the table for each payment mode. */
export const COUNTER_INSTRUCTION: Record<PayMode, string> = {
  upi: 'Bring bill + payment QR',
  card: 'Bring bill + card machine',
  cash: 'Bring bill (cash payment)',
};

export function counterInstruction(mode: string | null | undefined): string {
  return mode && Object.hasOwn(COUNTER_INSTRUCTION, mode) ? COUNTER_INSTRUCTION[mode as PayMode] : 'Bring bill';
}
