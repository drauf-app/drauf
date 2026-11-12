import { useT } from '../i18n';
import type { Chip, ChipGroups } from '../lib/chips';

interface ChipBarProps {
  groups: ChipGroups;
  onPick: (chip: Chip) => void;
  onDismiss: () => void;
}

function ChipButtons({ chips, onPick }: { chips: Chip[]; onPick: (chip: Chip) => void }) {
  return (
    <>
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          className={chip.highlighted ? 'chip highlighted' : 'chip'}
          onClick={() => onPick(chip)}
        >
          {chip.label}
        </button>
      ))}
    </>
  );
}

/** Count, size and variety chips that modify the entry just added (K2). */
export function ChipBar({ groups, onPick, onDismiss }: ChipBarProps) {
  const t = useT();
  return (
    <div className="chip-bar">
      <div className="chip-groups">
        <div className="chip-group">
          <ChipButtons chips={groups.counts} onPick={onPick} />
        </div>
        {groups.sizes.length > 0 && (
          <div className="chip-group">
            <ChipButtons chips={groups.sizes} onPick={onPick} />
          </div>
        )}
        {groups.varieties.length > 0 && (
          <div className="chip-group">
            <ChipButtons chips={groups.varieties} onPick={onPick} />
          </div>
        )}
      </div>
      <button
        type="button"
        className="chip-dismiss"
        aria-label={t.quickAdd.dismissChips}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
