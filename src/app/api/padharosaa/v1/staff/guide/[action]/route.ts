import { jsonOk, staffRoute } from '@/lib/api/route';
import { serverEnv } from '@/env';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { discoverNearby, describeWithAi } from '@/lib/padharosaa/discover';
import { tidyPlaceName } from '@/lib/padharosaa/places';
import { describeBody, discoverBody, guideCsvBody, guideSaveBody, idBody, importBody, itineraryBody, locationBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

interface Manage { location: { lat: number; lng: number } | null; items: { id: string; category: string; name: string; address: string | null; source: string; needs_review: boolean }[] }

// save | archive | location | itinerary | itinerary-archive | discover | import | csv | describe  (owner / manager; every write is checked again in SQL)
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return staffRoute(req, { method: 'POST' }, async (ctx, raw) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    switch (action) {
      case 'save': {
        const b = guideSaveBody.parse(raw);
        return jsonOk(await staffRpc(ctx.db, 'padh_guide_save', { p: { ...b, link_url: b.link_url ?? null } }), ctx.requestId);
      }
      case 'archive': {
        await staffRpc(ctx.db, 'padh_guide_archive', { p_id: idBody.parse(raw).id });
        return jsonOk({ ok: true }, ctx.requestId);
      }
      case 'location': {
        const b = locationBody.parse(raw);
        await staffRpc(ctx.db, 'padh_set_location', { p_lat: b.lat, p_lng: b.lng });
        return jsonOk({ ok: true }, ctx.requestId);
      }
      case 'itinerary':
        return jsonOk(await staffRpc(ctx.db, 'padh_itinerary_save', { p: itineraryBody.parse(raw) }), ctx.requestId);
      case 'itinerary-archive':
        await staffRpc(ctx.db, 'padh_itinerary_archive', { p_id: idBody.parse(raw).id });
        return jsonOk({ ok: true }, ctx.requestId);
      case 'discover': {
        const b = discoverBody.parse(raw ?? {});
        await limit(`psd:${ctx.userId}`, 6, 3600); // the free map service is shared: 6 searches an hour per person
        const g = await staffRpc<Manage>(ctx.db, 'padh_guide_manage');
        if (!g.location) throw new ApiError(422, 'invalid_input');
        const found = await discoverNearby(g.location, b.radius_m);
        if (!found) return jsonOk({ ok: false, reason: 'map_service_unavailable', candidates: [] }, ctx.requestId);
        const have = new Set(g.items.map((i) => `${i.category}:${i.name.toLowerCase()}`));
        return jsonOk({ ok: true, candidates: found.map((c) => ({ ...c, already: have.has(`${c.category}:${c.name.toLowerCase()}`) })) }, ctx.requestId);
      }
      case 'import': {
        const b = importBody.parse(raw);
        // clean names, and a place already in the guide (or listed twice) is added only once
        const g = await staffRpc<Manage>(ctx.db, 'padh_guide_manage');
        const have = new Set(g.items.map((i) => `${i.category}:${tidyPlaceName(i.name).toLowerCase()}`));
        let saved = 0, skipped = 0;
        for (const it of b.items) {
          const name = tidyPlaceName(it.name); const key = `${it.category}:${name.toLowerCase()}`;
          if (!name || have.has(key)) { skipped++; continue; }
          await staffRpc(ctx.db, 'padh_guide_save', { p: { category: it.category, name, lat: it.lat, lng: it.lng, address: it.address ?? null, source: 'osm' } });
          have.add(key); saved++;
        }
        return jsonOk({ saved, skipped }, ctx.requestId);
      }
      case 'csv': {
        // the manager's own list (parsed in the browser): saved as manual items, shown to guests at once or kept hidden; a name already in the guide is skipped, so the same file can be sent twice
        const b = guideCsvBody.parse(raw);
        await limit(`psc:${ctx.userId}`, 20, 3600);
        const g = await staffRpc<Manage>(ctx.db, 'padh_guide_manage');
        const have = new Set(g.items.map((i) => `${i.category}:${tidyPlaceName(i.name).toLowerCase()}`));
        let saved = 0, skipped = 0, failed = 0;
        for (const it of b.items) {
          const name = tidyPlaceName(it.name); const key = `${it.category}:${name.toLowerCase()}`;
          if (!name || have.has(key)) { skipped++; continue; }
          try {
            await staffRpc(ctx.db, 'padh_guide_save', { p: { ...it, name, link_url: it.link_url ?? null, source: 'manual', publish: b.publish } });
            have.add(key); saved++;
          } catch { failed++; }
        }
        return jsonOk({ saved, skipped, failed }, ctx.requestId);
      }
      case 'describe': {
        const b = describeBody.parse(raw);
        const env = serverEnv();
        if (!(env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL)) return jsonOk({ ok: false, reason: 'not_configured' }, ctx.requestId);
        await limit(`psa:${ctx.userId}`, 10, 3600);
        const g = await staffRpc<Manage>(ctx.db, 'padh_guide_manage');
        const wanted = g.items.filter((i) => b.ids.includes(i.id) && i.needs_review);
        const drafts = await describeWithAi({ baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL }, wanted.map((i) => ({ name: i.name, category: i.category, address: i.address })));
        if (!drafts) return jsonOk({ ok: false, reason: 'failed' }, ctx.requestId);
        let done = 0;
        for (const i of wanted) {
          const d = drafts.find((x) => x.name === i.name);
          if (!d || (!d.en && !d.hi)) continue;
          const full = (g as unknown as { items: Record<string, unknown>[] }).items.find((x) => x.id === i.id)!;
          // still a draft: the manager has to read it and publish it
          await staffRpc(ctx.db, 'padh_guide_save', { p: { ...full, description_en: d.en || full.description_en, description_hi: d.hi || full.description_hi, source: 'ai_draft', needs_review: true, active: false, sort: undefined, last_verified_at: undefined } });
          done++;
        }
        return jsonOk({ ok: true, drafted: done }, ctx.requestId);
      }
      default:
        throw new ApiError(404, 'not_found');
    }
  });
}
