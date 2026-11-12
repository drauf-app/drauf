import { parseItemLine } from '@drauf/shared';
import { type FormEvent, useRef, useState } from 'react';
import type { AddEntryInput } from '../api/lists';
import { fetchSuggestions } from '../api/lists';
import type { Suggestion } from '../api/types';
import { useT } from '../i18n';

const SUGGEST_DEBOUNCE_MS = 150;

interface QuickAddProps {
  onAdd: (input: AddEntryInput, suggestion?: Suggestion) => Promise<void>;
}

/**
 * The quick-add bar: suggestions from the first letter, tap to add, or
 * free text ("500 g Hack") parsed into quantity, unit and name on submit.
 */
export function QuickAdd({ onAdd }: QuickAddProps) {
  const t = useT();
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestSeq = useRef(0);

  function reset(): void {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
    }
    requestSeq.current += 1;
    setValue('');
    setSuggestions([]);
  }

  function updateValue(next: string): void {
    setValue(next);
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
    }
    const query = next.trim();
    if (query === '') {
      setSuggestions([]);
      return;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    timer.current = setTimeout(() => {
      fetchSuggestions(query)
        .then((result) => {
          // A stale response must not overwrite a newer query's result.
          if (requestSeq.current === seq) {
            setSuggestions(result);
          }
        })
        .catch(() => {
          if (requestSeq.current === seq) {
            setSuggestions([]);
          }
        });
    }, SUGGEST_DEBOUNCE_MS);
  }

  async function submitFreeText(event: FormEvent): Promise<void> {
    event.preventDefault();
    const parsed = parseItemLine(value);
    if (parsed.name.trim() === '') {
      return;
    }
    reset();
    await onAdd({
      name: parsed.name,
      ...(parsed.quantity !== undefined ? { quantity: parsed.quantity } : {}),
      ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
    });
  }

  async function pick(suggestion: Suggestion): Promise<void> {
    reset();
    await onAdd(
      {
        name: suggestion.name,
        ...(suggestion.categoryId !== null ? { categoryId: suggestion.categoryId } : {}),
      },
      suggestion,
    );
  }

  return (
    <div className="quick-add">
      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((suggestion) => (
            <li key={suggestion.name}>
              <button type="button" onClick={() => void pick(suggestion)}>
                <span className="suggestion-icon">{suggestion.icon}</span>
                <span className="suggestion-name">{suggestion.name}</span>
                {suggestion.source === 'history' && suggestion.lastVariant != null && (
                  <span className="suggestion-hint">{suggestion.lastVariant}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="quick-add-form" onSubmit={(event) => void submitFreeText(event)}>
        <input
          type="text"
          value={value}
          maxLength={100}
          placeholder={t.quickAdd.placeholder}
          aria-label={t.quickAdd.placeholder}
          autoComplete="off"
          onChange={(event) => updateValue(event.target.value)}
        />
        <button type="submit" className="primary">
          {t.quickAdd.add}
        </button>
      </form>
    </div>
  );
}
