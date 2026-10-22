import { cache } from 'react';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverEnv } from '@/env';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { GUEST_COOKIE, verifyGuestCookie } from '@/lib/security/cookie';
import { clientIp, hashIp } from '@/lib/security/ip';
import { slugParam } from '@/lib/schemas/guest';
import { t } from '@/lib/i18n';
import type { MenuData } from '@/lib/guest/types';
import { GuestApp } from '@/components/guest/GuestApp';
import { StatePage } from '@/components/guest/StatePage';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string | string[] }> };

const TOKEN = /^[0-9a-f]{64}$/;

// One database call per request even though both the page and its metadata need the menu.
const loadMenu = cache(async (slug: string, token: string | null): Promise<MenuData> => {
  const h = await headers();
  const env = serverEnv();
  await limit(`menu:${hashIp(clientIp(h), env.IP_HASH_SALT)}`, 120, 60);
  return rpc<MenuData>('guest_get_menu', { p_slug: slug, p_token: token });
});

const tokenFrom = (k: string | string[] | undefined) => {
  const v = Array.isArray(k) ? k[0] : k;
  return v && TOKEN.test(v) ? v : null;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!slugParam.safeParse(slug).success) return {};
  try {
    const m = await loadMenu(slug, null);
    return { title: m.restaurant.name };
  } catch {
    return {};
  }
}

export default async function RestaurantPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { k } = await searchParams;
  if (!slugParam.safeParse(slug).success) notFound();

  const jar = await cookies();
  const rawK = Array.isArray(k) ? k[0] : k;
  const token = tokenFrom(k);

  let menu: MenuData;
  try {
    menu = await loadMenu(slug, token);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 429) {
      return <StatePage t={t} title={t('state.tooMany.title')} body={t('state.tooMany.body')} />;
    }
    throw e; // error.tsx shows a friendly page; details only in logs
  }

  if (menu.status === 'suspended') {
    return <StatePage t={t} title={t('state.suspended.title')} body={t('state.suspended.body')} />;
  }

  const session = verifyGuestCookie(jar.get(GUEST_COOKIE)?.value, serverEnv().GUEST_COOKIE_SECRET);
  const imageBase = `${serverEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/menu-images/`;

  return (
    <GuestApp
      menu={menu}
      slug={slug}
      // A malformed ?k= is treated as "invalid QR" (shown), not silently ignored.
      token={token ?? (rawK ? 'invalid' : null)}
      hasCookie={session?.slug === slug}
      imageBase={imageBase}
    />
  );
}
