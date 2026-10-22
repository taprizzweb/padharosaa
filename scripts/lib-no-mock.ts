import type { Client } from 'pg';

/** Tables that can hold demo content, and the condition that makes a row "active". */
const CHECKS: { table: string; where: string }[] = [
  { table: 'hotel_settings', where: 'is_mock and enabled' },
  { table: 'guide_items', where: 'is_mock and active' },
  { table: 'itineraries', where: 'is_mock and active' },
  { table: 'places', where: 'is_mock and active' },
];

/** Returns one problem line per table that still has active mock rows. Empty = clean. */
export async function findMock(client: Pick<Client, 'query'>): Promise<string[]> {
  const problems: string[] = [];
  for (const { table, where } of CHECKS) {
    const exists = await client.query(`select to_regclass($1) as t`, [`public.${table}`]);
    if (!exists.rows[0]?.t) continue; // Menu Lite database without Padharosaa tables: nothing to check
    const r = await client.query<{ n: number }>(`select count(*)::int n from public.${table} where ${where}`);
    if ((r.rows[0]?.n ?? 0) > 0) problems.push(`${r.rows[0]!.n} active mock row(s) in public.${table}`);
  }
  // the demo restaurant itself
  const demo = await client.query<{ n: number }>(`select count(*)::int n from public.restaurants where slug like '%-demo'`);
  if ((demo.rows[0]?.n ?? 0) > 0) problems.push(`${demo.rows[0]!.n} restaurant(s) with a demo slug (*-demo)`);
  return problems;
}
