/** The one outside link on the public menu: "Explore more before leaving". The owner types only the last part. */
export const EXPLORE_BASE = 'https://smarty.taprizz.in/sq/';
export const EXPLORE_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** Accepts the code on its own or the whole link (pasted by mistake) and returns just the code, or '' when it is not safe. */
export function normalizeExploreCode(input: string): string {
  let v = input.trim();
  if (v.toLowerCase().startsWith(EXPLORE_BASE)) v = v.slice(EXPLORE_BASE.length);
  v = v.replace(/\/+$/, '');
  return EXPLORE_CODE.test(v) ? v : '';
}

export const exploreUrl = (code: string): string => `${EXPLORE_BASE}${code}`;
