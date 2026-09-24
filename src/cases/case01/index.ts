import { buildCase } from '../../engine/buildCase';
import type { CaseData } from '../../engine/types';
import type { Locale } from '../../i18n/locale';
import { rules } from './rules';
import { en } from './en';
import { ru } from './ru';

export { rules as case01Rules };
export const case01Text = { en, ru };

/** Case 01 in every supported language. All versions share the same rules and ids. */
export const case01: Record<Locale, CaseData> = {
  en: buildCase(rules, en),
  ru: buildCase(rules, ru),
};
