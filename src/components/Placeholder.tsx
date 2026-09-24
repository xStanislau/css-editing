/** Obvious stand-in until approved art is supplied. Keep the label descriptive: it doubles as the art brief. */
export function Placeholder({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div className={`placeholder${tall ? ' placeholder--tall' : ''}`} role="img" aria-label={`Placeholder art: ${label}`}>
      <span className="placeholder__tag">Placeholder art</span>
      <span className="placeholder__label">{label}</span>
    </div>
  );
}
