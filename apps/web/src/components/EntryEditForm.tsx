import { type FormEvent, useState } from 'react';
import type { PatchEntryInput } from '../api/lists';
import type { Category, EntryView } from '../api/types';
import { useT } from '../i18n';
import { IconPicker } from './IconPicker';

interface EntryEditFormProps {
  entry: EntryView;
  categories: Category[];
  onSave: (fields: PatchEntryInput) => void;
  onCancel: () => void;
  /** Deleting lives here: a deliberate two-step instead of a tiny row icon. */
  onDelete?: () => void;
}

/**
 * Inline editor for one entry. Only changed fields are sent; an emptied
 * quantity clears all portions (unit '' is the API's "no quantity" signal),
 * and a quantity edit replaces merged portions with the one value entered.
 */
export function EntryEditForm({
  entry,
  categories,
  onSave,
  onCancel,
  onDelete,
}: EntryEditFormProps) {
  const t = useT();
  const firstQuantity = entry.quantities[0];
  const [name, setName] = useState(entry.name);
  const [quantity, setQuantity] = useState(
    firstQuantity === undefined ? '' : String(firstQuantity.quantity),
  );
  const [unit, setUnit] = useState(firstQuantity?.unit ?? '');
  const [count, setCount] = useState(
    firstQuantity?.count === undefined ? '' : String(firstQuantity.count),
  );
  const [variant, setVariant] = useState(entry.variant ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const [categoryId, setCategoryId] = useState(entry.categoryId ?? '');
  // '' = automatic (whatever the catalogue matcher resolves).
  const [icon, setIcon] = useState(entry.icon ?? '');

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    const fields: PatchEntryInput = {};
    const trimmedName = name.trim();
    if (trimmedName !== '' && trimmedName !== entry.name) {
      fields.name = trimmedName;
    }
    if (variant.trim() !== (entry.variant ?? '')) {
      fields.variant = variant.trim();
    }
    if (note.trim() !== (entry.note ?? '')) {
      fields.note = note.trim();
    }
    if (categoryId !== (entry.categoryId ?? '')) {
      fields.categoryId = categoryId;
    }
    if (icon !== (entry.icon ?? '')) {
      fields.icon = icon; // '' = back to the catalogue match
    }
    const parsedQuantity = Number(quantity.trim().replace(',', '.'));
    const parsedCount = Number(count.trim());
    const countValid =
      count.trim() !== '' && Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 99;
    const amountChanged =
      quantity.trim() !== (firstQuantity === undefined ? '' : String(firstQuantity.quantity)) ||
      unit.trim() !== (firstQuantity?.unit ?? '') ||
      count.trim() !== (firstQuantity?.count === undefined ? '' : String(firstQuantity.count));
    if (amountChanged) {
      if (quantity.trim() === '' && !countValid) {
        if (firstQuantity !== undefined) {
          fields.unit = ''; // clears all portions
        }
      } else if (quantity.trim() === '') {
        fields.count = parsedCount; // a bare pack count ("3")
      } else if (Number.isFinite(parsedQuantity) && parsedQuantity > 0) {
        fields.quantity = parsedQuantity;
        fields.unit = unit.trim();
        if (countValid) {
          fields.count = parsedCount;
        }
      }
    }
    if (Object.keys(fields).length === 0) {
      onCancel();
      return;
    }
    onSave(fields);
  }

  return (
    <form className="entry-edit" onSubmit={onSubmit}>
      <label className="entry-edit-wide">
        {t.list.edit.name}
        <input
          type="text"
          value={name}
          maxLength={100}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        {t.list.edit.count}
        <input
          type="text"
          inputMode="numeric"
          value={count}
          maxLength={2}
          onChange={(event) => setCount(event.target.value)}
        />
      </label>
      <label>
        {t.list.edit.quantity}
        <input
          type="text"
          inputMode="decimal"
          value={quantity}
          maxLength={10}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </label>
      <label>
        {t.list.edit.unit}
        <input
          type="text"
          value={unit}
          maxLength={32}
          onChange={(event) => setUnit(event.target.value)}
        />
      </label>
      <label>
        {t.list.edit.variant}
        <input
          type="text"
          value={variant}
          maxLength={64}
          onChange={(event) => setVariant(event.target.value)}
        />
      </label>
      <label>
        {t.list.edit.category}
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">{t.list.uncategorized}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className="entry-edit-wide">
        {t.list.edit.note}
        <input
          type="text"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="entry-edit-wide entry-edit-icon">
        <span className="entry-edit-icon-label">{t.list.edit.icon}</span>
        <IconPicker
          value={icon}
          clearLabel={t.list.edit.iconAuto}
          pickLabel={t.list.edit.iconPick}
          onChange={setIcon}
        />
      </div>
      <div className="entry-edit-actions">
        <button type="submit" className="primary">
          {t.common.save}
        </button>
        <button type="button" onClick={onCancel}>
          {t.common.cancel}
        </button>
        {onDelete !== undefined && (
          <button type="button" className="danger" onClick={onDelete}>
            {t.list.deleteEntry}
          </button>
        )}
      </div>
    </form>
  );
}
