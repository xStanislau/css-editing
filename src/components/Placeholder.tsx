import { useUi } from '../i18n/ui';

/** Obvious stand-in until approved art is supplied. Keep the label descriptive: it doubles as the art brief. */
export function Placeholder({ label, tall = false }: { label: string; tall?: boolean }) {
  const ui = useUi();
  return (
    <div className={`placeholder${tall ? ' placeholder--tall' : ''}`} role="img" aria-label={ui.placeholder.ariaLabel(label)}>
      <span className="placeholder__tag">{ui.placeholder.tag}</span>
      <span className="placeholder__label">{label}</span>
    </div>
  );
}
