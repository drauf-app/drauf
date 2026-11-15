import { useState } from 'react';
import { BUNDLED_EMOJIS } from '../lib/openmoji';
import { ItemIcon } from './ItemIcon';

interface IconPickerProps {
  /** The picked emoji, or '' for "none"/"automatic". */
  value: string;
  /** Label for the no-icon choice ("Automatisch", "Kein Icon"). */
  clearLabel: string;
  /** Accessible name of the toggle button. */
  pickLabel: string;
  onChange: (icon: string) => void;
}

/**
 * A toggle showing the current choice that opens a scrollable grid of the
 * bundled OpenMoji set; one tap picks and closes. Used for item icons in the
 * entry editor and for list icons.
 */
export function IconPicker({ value, clearLabel, pickLabel, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);

  function pick(icon: string): void {
    onChange(icon);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="icon-picker-toggle"
        aria-label={pickLabel}
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        {value === '' ? clearLabel : <ItemIcon icon={value} />}
      </button>
      {open && (
        <div className="icon-picker">
          <button
            type="button"
            className={value === '' ? 'icon-option active' : 'icon-option'}
            onClick={() => pick('')}
          >
            {clearLabel}
          </button>
          {BUNDLED_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={emoji === value ? 'icon-option active' : 'icon-option'}
              aria-label={emoji}
              onClick={() => pick(emoji)}
            >
              <ItemIcon icon={emoji} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
