/* eslint-disable @typescript-eslint/no-explicit-any -- each action's input type is fixed by its own zod schema; the table maps names to them */
import type { ZodType } from 'zod';
import { parseRooms } from '@/lib/rooms';
import * as S from '@/lib/schemas/dash';
import { availabilityBody } from '@/lib/schemas/staff';

/**
 * Dashboard actions: each maps one JSON request onto one role-checked SQL function (the database decides who may do what).
 * Staff-account actions that need Supabase Auth (create user, reset password) are handled separately in the route.
 */
export interface DashAction {
  method: 'GET' | 'POST';
  rpc: string;
  schema?: ZodType<any>;
  args: (input: any) => Record<string, unknown>;
  /** shape the SQL result for the browser */
  result?: (data: any) => unknown;
}

const none = () => ({});

export const DASH_ACTIONS: Record<string, DashAction> = {
  // ---- reads
  menu: { method: 'GET', rpc: 'mgr_get_menu', args: none },
  settings: { method: 'GET', rpc: 'mgr_get_settings', args: none },
  staff: { method: 'GET', rpc: 'mgr_get_staff', args: none },
  tables: { method: 'GET', rpc: 'mgr_get_table_tokens', args: none, result: (rows: unknown[]) => ({ tables: rows }) },
  'table-link': { method: 'GET', rpc: 'mgr_get_table_link', args: none },
  'help-link': { method: 'GET', rpc: 'mgr_get_help_link', args: none },
  'room-service': { method: 'GET', rpc: 'mgr_get_room_service', args: none },
  report: { method: 'GET', rpc: 'mgr_report', schema: S.reportQuery, args: (q: { range: string }) => ({ p_range: q.range }) },
  analytics: { method: 'GET', rpc: 'mgr_analytics', schema: S.analyticsQuery, args: (q: { range: string }) => ({ p_range: q.range }) },
  audit: { method: 'GET', rpc: 'mgr_get_audit', schema: S.auditQuery, args: (q: { limit: number; before?: number }) => ({ p_limit: q.limit, p_before: q.before ?? null }), result: (rows: unknown[]) => ({ entries: rows }) },

  // ---- menu
  'category-save': { method: 'POST', rpc: 'mgr_save_category', schema: S.categorySave, args: (b) => ({ p_id: b.id ?? null, p_name: b.name, p_active: b.active }), result: (id: string) => ({ id }) },
  'category-delete': { method: 'POST', rpc: 'mgr_delete_category', schema: S.idOnly, args: (b) => ({ p_id: b.id }), result: () => ({ ok: true }) },
  'categories-reorder': { method: 'POST', rpc: 'mgr_reorder_categories', schema: S.categoriesReorder, args: (b) => ({ p_ids: b.ids }), result: () => ({ ok: true }) },
  'item-save': {
    method: 'POST', rpc: 'mgr_save_item', schema: S.itemSave,
    args: (b) => ({ p_id: b.id ?? null, p_category: b.category_id, p_name: b.name, p_description: b.description ?? null, p_price_paise: b.price_paise, p_diet: b.diet, p_spice: b.spice, p_image_path: b.image_path ?? null, p_bestseller: b.is_bestseller, p_chef_pick: b.is_chef_pick, p_available: b.is_available ?? null }),
    result: (id: string) => ({ id }),
  },
  'item-choices-save': { method: 'POST', rpc: 'mgr_save_item_choices', schema: S.itemChoicesSave, args: (b) => ({ p_item_id: b.item_id, p_variants: b.variants, p_groups: b.groups }), result: () => ({ ok: true }) },
  'item-delete': { method: 'POST', rpc: 'mgr_delete_item', schema: S.idOnly, args: (b) => ({ p_id: b.id }), result: () => ({ ok: true }) },
  'items-delete': { method: 'POST', rpc: 'mgr_delete_items', schema: S.itemsDelete, args: (b) => ({ p_ids: b.item_ids }), result: (n: number) => ({ deleted: n }) },
  'category-delete-all': { method: 'POST', rpc: 'mgr_delete_category_all', schema: S.idOnly, args: (b) => ({ p_id: b.id }), result: (n: number) => ({ deleted: n }) },
  'item-duplicate': { method: 'POST', rpc: 'mgr_duplicate_item', schema: S.idOnly, args: (b) => ({ p_id: b.id }), result: (id: string) => ({ id }) },
  'items-availability': { method: 'POST', rpc: 'staff_set_item_availability', schema: availabilityBody, args: (b) => ({ p_item_ids: b.item_ids, p_available: b.available }), result: (n: number) => ({ changed: n }) },
  'items-reorder': { method: 'POST', rpc: 'mgr_reorder_items', schema: S.itemsReorder, args: (b) => ({ p_category: b.category_id, p_ids: b.ids }), result: () => ({ ok: true }) },
  'items-bulk-price': { method: 'POST', rpc: 'mgr_bulk_price', schema: S.bulkPrice, args: (b) => ({ p_item_ids: b.item_ids, p_mode: b.mode, p_value: b.value }), result: (n: number) => ({ changed: n }) },
  'menu-import': { method: 'POST', rpc: 'mgr_import_items', schema: S.menuImport, args: (b) => ({ p_rows: b.rows.map((r: any) => ({ ...r })) }) },

  // ---- tables, settings
  'table-save': { method: 'POST', rpc: 'mgr_save_table', schema: S.tableSave, args: (b) => ({ p_id: b.id, p_label: b.label, p_active: b.active }), result: () => ({ ok: true }) },
  'tables-create': { method: 'POST', rpc: 'mgr_create_tables', schema: S.tablesCreate, args: (b) => ({ p_from: b.from, p_to: b.to }), result: (n: number) => ({ created: n }) },
  'table-rotate': { method: 'POST', rpc: 'mgr_rotate_table_token', schema: S.idOnly, args: (b) => ({ p_table_id: b.id }), result: () => ({ ok: true }) },
  'room-service-save': {
    method: 'POST', rpc: 'mgr_set_room_service', schema: S.roomServiceSave,
    args: (b) => {
      const parsed = parseRooms(b.rooms);
      return { p_enabled: b.enabled, p_rooms: parsed.ok ? parsed.rooms : [], p_rotate: b.rotate ?? false };
    },
    result: () => ({ ok: true }),
  },
  'table-link-save': { method: 'POST', rpc: 'mgr_set_table_link', schema: S.tableLinkSave, args: (b) => ({ p_enabled: b.enabled, p_rotate: b.rotate ?? false }), result: () => ({ ok: true }) },
  'help-link-save': { method: 'POST', rpc: 'mgr_set_help_link', schema: S.helpLinkSave, args: (b) => ({ p_enabled: b.enabled, p_topics: b.topics, p_rotate: b.rotate ?? false }), result: () => ({ ok: true }) },
  'profile-save': {
    method: 'POST', rpc: 'mgr_update_profile', schema: S.profileSave,
    args: (b) => ({ p_tagline: b.tagline, p_description: b.description, p_logo: b.logo_path, p_banner: b.banner_path, p_address: b.address, p_hours: b.hours_text, p_explore: b.explore_code }),
    result: () => ({ ok: true }),
  },
  'location-save': {
    method: 'POST', rpc: 'mgr_update_location', schema: S.locationSave,
    args: (b) => ({ p_required: b.required, p_lat: b.lat, p_lng: b.lng, p_radius: b.radius_m }),
    result: () => ({ ok: true }),
  },
  'settings-save': {
    method: 'POST', rpc: 'mgr_update_settings', schema: S.settingsSave,
    args: (b) => ({ p_name: b.name, p_review_url: b.review_url || null, p_accent: b.accent, p_amber: b.amber_minutes, p_red: b.red_minutes }),
    result: () => ({ ok: true }),
  },
};
