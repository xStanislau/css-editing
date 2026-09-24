import type { Locale } from '../i18n/locale';
import { useUi } from '../i18n/ui';

// Each name is written in its own language and tagged with lang= so screen readers pronounce it correctly.
const OPTIONS: { locale: Locale; name: string }[] = [
  { locale: 'en', name: 'English' },
  { locale: 'ru', name: 'Русский' },
];

export function LanguageSwitch({ locale, onChange }: { locale: Locale; onChange: (l: Locale) => void }) {
  const ui = useUi();
  return (
    <div className="lang-switch" role="group" aria-label={ui.languageGroupLabel}>
      {OPTIONS.map((o, i) => (
        <span key={o.locale}>
          {i > 0 && (
            <span className="lang-switch__sep" aria-hidden="true">
              /
            </span>
          )}
          <button
            type="button"
            lang={o.locale}
            className="lang-switch__btn"
            aria-pressed={locale === o.locale}
            onClick={() => onChange(o.locale)}
          >
            {o.name}
          </button>
        </span>
      ))}
    </div>
  );
}
