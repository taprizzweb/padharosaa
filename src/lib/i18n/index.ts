import { en, type MessageKey } from './en';

export type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** All user-facing text lives in en.ts; this fills in {placeholders}. */
export const t: Translator = (key, vars) => {
  const template = en[key];
  return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template;
};

/** Error keys from the API -> message key. Anything unknown falls back to the generic server error. */
export function errorMessageKey(apiKey: string | undefined): MessageKey {
  const k = `error.${apiKey ?? 'server_error'}` as MessageKey;
  return Object.hasOwn(en, k) ? k : 'error.server_error';
}

export type { MessageKey };
export { en };
