/**
 * Maps database error codes (see migration 0005 header) to an HTTP status and a stable message KEY.
 * The browser translates the key into Hindi/English. Raw database text is never sent to users.
 */
export const SQL_ERRORS = {
  GM001: { status: 403, key: 'restaurant_suspended' },
  GM002: { status: 403, key: 'invalid_table_token' },
  GM003: { status: 409, key: 'item_unavailable' },
  GM004: { status: 409, key: 'item_not_found' },
  GM005: { status: 400, key: 'duplicate_item' },
  GM006: { status: 422, key: 'limit_exceeded' },
  GM007: { status: 429, key: 'rate_limited' },
  GM008: { status: 429, key: 'too_many_pending' },
  GM009: { status: 409, key: 'session_closed' },
  GM010: { status: 409, key: 'invalid_transition' },
  GM011: { status: 403, key: 'forbidden' },
  GM012: { status: 404, key: 'not_found' },
  GM013: { status: 409, key: 'unserved_orders' },
  GM014: { status: 400, key: 'reason_required' },
  GM015: { status: 400, key: 'invalid_input' },
  GM016: { status: 409, key: 'no_orders' },
  GM018: { status: 409, key: 'category_not_empty' },
  GM019: { status: 409, key: 'conflict' },
  GM020: { status: 403, key: 'protected' },
  GM021: { status: 403, key: 'mfa_required' },
  GM022: { status: 422, key: 'unknown_room' },
  GM024: { status: 503, key: 'verification_unavailable' },
  GM025: { status: 403, key: 'service_closed' },
  GM026: { status: 409, key: 'balance_due' },
  GM027: { status: 409, key: 'stay_open' },
} as const;

export type ErrorKey = (typeof SQL_ERRORS)[keyof typeof SQL_ERRORS]['key'] | 'not_configured' | 'location_required' | 'location_inaccurate' | 'too_far_from_restaurant' | 'origin_not_allowed' | 'unsupported_media_type' | 'payload_too_large' | 'unauthorized' | 'password_change_required' | 'invalid_credentials' | 'method_not_allowed' | 'server_error' | 'channel_unavailable' | 'login_failed' | 'locked';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly key: ErrorKey,
  ) {
    super(key);
    this.name = 'ApiError';
  }
}

export interface DbError {
  code?: string;
  message?: string;
}

/** Known database codes become ApiErrors; anything else is `null` (caller logs it and returns a generic 500). */
export function fromDbError(e: DbError | null | undefined): ApiError | null {
  const known = e?.code && Object.hasOwn(SQL_ERRORS, e.code) ? SQL_ERRORS[e.code as keyof typeof SQL_ERRORS] : undefined;
  return known ? new ApiError(known.status, known.key) : null;
}
