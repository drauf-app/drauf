import { useT } from '../i18n';

/** The fixed list colours, in the order of i18n lists.colorNames. */
export const LIST_COLORS: readonly string[] = [
  '#167a47',
  '#2563eb',
  '#0d9488',
  '#d97706',
  '#dc2626',
  '#db2777',
  '#7c3aed',
];

interface ColorSwatchesProps {
  /** The chosen #rrggbb colour, or '' for none. */
  value: string;
  onChange: (color: string) => void;
}

/** One row of colour dots for a list; the first option clears the colour. */
export function ColorSwatches({ value, onChange }: ColorSwatchesProps) {
  const t = useT();
  return (
    <div className="color-swatches">
      <button
        type="button"
        className={value === '' ? 'color-swatch none active' : 'color-swatch none'}
        aria-label={t.lists.colorNone}
        aria-pressed={value === ''}
        onClick={() => onChange('')}
      />
      {LIST_COLORS.map((color, index) => (
        <button
          key={color}
          type="button"
          className={value === color ? 'color-swatch active' : 'color-swatch'}
          style={{ background: color }}
          aria-label={t.lists.colorNames[index] ?? color}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}
