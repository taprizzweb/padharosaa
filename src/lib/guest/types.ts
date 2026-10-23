import type { AccentKey } from '@/lib/accent';

export type Diet = 'veg' | 'nonveg' | 'egg' | 'jain';

export interface MenuItem {
  id: string;
  name_en: string;
  description_en: string | null;
  price_paise: number;
  diet: Diet;
  spice: number;
  image_path: string | null;
  is_available: boolean;
  is_bestseller: boolean;
  is_chef_pick: boolean;
  /** sizes (Small / Large, Half / Full...), each with its own price; empty when the dish has no sizes */
  variants?: MenuVariant[];
  /** extra choices (sauce, extras...) */
  option_groups?: MenuOptionGroup[];
}

export interface MenuVariant { id: string; name: string; price_paise: number; is_available: boolean }
export interface MenuOption { id: string; name: string; price_delta_paise: number }
export interface MenuOptionGroup { id: string; name: string; required: boolean; max_select: number; options: MenuOption[] }

export interface MenuCategory {
  id: string;
  name_en: string;
  items: MenuItem[];
}

export interface MenuData {
  status: 'active' | 'suspended';
  restaurant: {
    name: string; slug?: string; accent?: AccentKey;
    tagline?: string | null; description?: string | null; logo_path?: string | null; banner_path?: string | null;
    address?: string | null; hours_text?: string | null; explore_code?: string | null;
  };
  table_label?: string | null;
  token_valid?: boolean;
  /** true when the link is the restaurant's shared room-service link (a room number is asked before ordering) */
  room_link?: boolean;
  rooms?: string[] | null;
  /** true on the shared table link (the guest picks a table from `tables`) */
  table_link?: boolean;
  tables?: string[] | null;
  categories?: MenuCategory[];
}

export type OrderStatus = 'placed' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type PayMode = 'cash' | 'upi' | 'card';
export type WaiterReason = 'water' | 'cutlery' | 'cleaning' | 'help' | 'other';

export interface StatusOrderItem {
  name_en: string;
  qty: number;
  unit_price_paise: number;
  note: string | null;
}
export interface StatusOrder {
  order_no: number;
  status: OrderStatus;
  note: string | null;
  total_paise: number;
  created_at: string;
  cancel_reason: string | null;
  /** room orders: how the order reaches the guest, chosen by the kitchen */
  handover?: 'deliver' | 'takeaway' | null;
  items: StatusOrderItem[];
}
export interface StatusRequest {
  type: 'waiter' | 'bill';
  reason: WaiterReason | null;
  pay_mode: PayMode | null;
  status: 'open' | 'done';
  created_at: string;
}
export interface StatusData {
  state: 'open' | 'closed' | 'expired';
  restaurant?: { name: string; slug: string; accent: AccentKey; status: string };
  table_label?: string;
  pay_mode?: PayMode | null;
  bill_requested?: boolean;
  total_paise?: number;
  orders?: StatusOrder[];
  requests?: StatusRequest[];
}

export interface CartLine {
  /** the line's own key: the dish id for a plain dish, `dish|size|options` for a customised one */
  id: string;
  /** the dish (older saved carts did not store it: it then equals `id`) */
  item_id: string;
  variant_id?: string;
  option_ids?: string[];
  qty: number;
  note?: string;
}
