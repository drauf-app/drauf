import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { type ApplyInput, applyImport, type ImportPreview, previewImport } from '../api/import';
import { fetchLists } from '../api/lists';
import { fetchSlots } from '../api/plan';
import type { List, MealSlot } from '../api/types';
import { ApiError } from '../auth/store';
import { ProxiedImage } from '../components/ProxiedImage';
import { useT } from '../i18n';
import { ingredientLabel, servingsFactor, toApplyItem } from '../lib/import';
import { formatDay, isoDate } from '../lib/week';

function upcomingDays(count: number): string[] {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index);
    return isoDate(day);
  });
}

function rememberedListId(): string | undefined {
  try {
    return localStorage.getItem('drauf.last-list') ?? undefined;
  } catch {
    return undefined;
  }
}

export function ImportPage() {
  const t = useT();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [servings, setServings] = useState(1);
  const [lists, setLists] = useState<List[]>([]);
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [listId, setListId] = useState('');
  const [toList, setToList] = useState(true);
  const [toPlan, setToPlan] = useState(false);
  const [planDate, setPlanDate] = useState(isoDate(new Date()));
  const [slotId, setSlotId] = useState('');

  const days = upcomingDays(14);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchLists(), fetchSlots()])
      .then(([listsResult, slotsResult]) => {
        if (cancelled) {
          return;
        }
        const active = listsResult.filter((list) => !list.archived);
        setLists(active);
        const remembered = rememberedListId();
        setListId(active.find((list) => list.id === remembered)?.id ?? active[0]?.id ?? '');
        const sorted = [...slotsResult].sort((a, b) => a.sortOrder - b.sortOrder);
        setSlots(sorted);
        setSlotId(sorted[0]?.id ?? '');
      })
      .catch(() => {
        if (!cancelled) setError(t.common.error);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function onPreview(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (input.trim() === '' || busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    try {
      const result = await previewImport(input.trim());
      setPreview(result);
      setServings(result.servings ?? 1);
      setSelected(
        new Set(
          result.ingredients.flatMap((ingredient, index) => (ingredient.isStaple ? [] : [index])),
        ),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_provider') {
        setError(t.import.noProvider);
      } else if (err instanceof ApiError && err.code === 'timeout') {
        setError(t.import.timeout);
      } else if (err instanceof ApiError && err.code === 'parse_failed') {
        setError(t.import.parseFailed);
      } else if (err instanceof ApiError) {
        setError(t.import.fetchFailed);
      } else {
        setError(t.login.errors.network);
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleIngredient(index: number): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  async function onApply(): Promise<void> {
    if (preview === undefined || busy) {
      return;
    }
    const factor = servingsFactor(preview.servings, servings);
    const items = preview.ingredients
      .filter((_, index) => selected.has(index))
      .map((ingredient) => toApplyItem(ingredient, factor));
    const wantList = toList && listId !== '' && items.length > 0;
    const wantPlan = toPlan;
    if (!wantList && !wantPlan) {
      setError(t.import.nothingSelected);
      return;
    }
    const request: ApplyInput = {
      ...(wantList ? { list: { id: listId, items } } : {}),
      ...(wantPlan
        ? {
            plan: {
              date: planDate,
              // The meal label is optional; days hold any number of entries.
              ...(slotId === '' ? {} : { slotId }),
              link: preview.url,
              ...(preview.title === null ? {} : { title: preview.title }),
              ...(preview.imageUrl === null ? {} : { imageUrl: preview.imageUrl }),
            },
          }
        : {}),
    };
    setBusy(true);
    setError(undefined);
    try {
      await applyImport(request);
      await navigate(wantList ? `/lists/${encodeURIComponent(listId)}` : '/plan');
    } catch {
      setError(t.common.error);
    } finally {
      setBusy(false);
    }
  }

  const factor = preview === undefined ? 1 : servingsFactor(preview.servings, servings);

  return (
    <section className="import-page">
      <h1>{t.import.title}</h1>
      <form className="import-input" onSubmit={(event) => void onPreview(event)}>
        <input
          type="text"
          value={input}
          maxLength={4096}
          placeholder={t.import.inputPlaceholder}
          aria-label={t.import.inputLabel}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" className="primary" disabled={busy}>
          {t.import.preview}
        </button>
      </form>
      {error !== undefined && <p className="error">{error}</p>}

      {preview !== undefined && (
        <div className="import-preview">
          <div className="import-head">
            {preview.imageUrl !== null && (
              <ProxiedImage className="import-image" imageUrl={preview.imageUrl} />
            )}
            <div>
              <h2>{preview.title ?? preview.url}</h2>
              <div className="import-servings">
                <button
                  type="button"
                  aria-label={t.import.fewerServings}
                  disabled={servings <= 1}
                  onClick={() => setServings(servings - 1)}
                >
                  −
                </button>
                <span>
                  {servings} {t.import.servings}
                </span>
                <button
                  type="button"
                  aria-label={t.import.moreServings}
                  onClick={() => setServings(servings + 1)}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <h3>{t.import.ingredients}</h3>
          <ul className="import-ingredients">
            {preview.ingredients.map((ingredient, index) => (
              <li key={ingredient.raw}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(index)}
                    onChange={() => toggleIngredient(index)}
                  />
                  {ingredientLabel(ingredient, factor)}
                </label>
              </li>
            ))}
          </ul>

          <div className="import-targets">
            <label className="import-target">
              <input
                type="checkbox"
                checked={toList}
                onChange={(event) => setToList(event.target.checked)}
              />
              {t.import.toList}
            </label>
            {toList && (
              <select
                aria-label={t.import.toList}
                value={listId}
                onChange={(event) => setListId(event.target.value)}
              >
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            )}
            <label className="import-target">
              <input
                type="checkbox"
                checked={toPlan}
                onChange={(event) => setToPlan(event.target.checked)}
              />
              {t.import.toPlan}
            </label>
            {toPlan && (
              <div className="import-plan-target">
                <select
                  aria-label={t.import.day}
                  value={planDate}
                  onChange={(event) => setPlanDate(event.target.value)}
                >
                  {days.map((day) => (
                    <option key={day} value={day}>
                      {formatDay(day)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t.import.slot}
                  value={slotId}
                  onChange={(event) => setSlotId(event.target.value)}
                >
                  <option value="">{t.plan.noSlot}</option>
                  {slots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <button type="button" className="primary" disabled={busy} onClick={() => void onApply()}>
            {t.import.apply}
          </button>
        </div>
      )}
    </section>
  );
}
