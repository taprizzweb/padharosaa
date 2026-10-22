import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverEnv } from '@/env';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { clientIp, hashIp } from '@/lib/security/ip';
import { slugParam } from '@/lib/schemas/guest';
import { t } from '@/lib/i18n';
import type { AccentKey } from '@/lib/accent';
import { HelpForm } from '@/components/guest/HelpForm';
import { StatePage } from '@/components/guest/StatePage';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Call for problems', robots: { index: false } };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string | string[] }> };
const TOKEN = /^[0-9a-f]{64}$/;

interface HelpPage {
  status: 'active' | 'suspended';
  restaurant: { name: string; slug?: string; accent?: AccentKey };
  topics?: string[];
  rooms?: string[];
}

/** The shared "call for problems" page of a hotel: reached from the Smart page. Only the restaurant's own help link opens it. */
export default async function HelpRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const { k } = await searchParams;
  if (!slugParam.safeParse(slug).success) notFound();
  const raw = Array.isArray(k) ? k[0] : k;
  const invalid = <StatePage t={t} title={t('help.invalidTitle')} body={t('help.invalidBody')} />;
  if (!raw || !TOKEN.test(raw)) return invalid;

  const h = await headers();
  await limit(`menu:${hashIp(clientIp(h), serverEnv().IP_HASH_SALT)}`, 120, 60);
  let page: HelpPage;
  try {
    page = await rpc<HelpPage>('guest_get_help', { p_slug: slug, p_token: raw });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.key === 'invalid_table_token') return invalid;
    if (e instanceof ApiError && e.status === 429) return <StatePage t={t} title={t('state.tooMany.title')} body={t('state.tooMany.body')} />;
    throw e;
  }
  if (page.status === 'suspended') return <StatePage t={t} title={t('state.suspended.title')} body={t('state.suspended.body')} />;
  return <HelpForm slug={slug} token={raw} name={page.restaurant.name} accent={page.restaurant.accent ?? 'saffron'} topics={page.topics ?? []} rooms={page.rooms ?? []} />;
}
