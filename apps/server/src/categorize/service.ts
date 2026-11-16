import type { CatalogIndex } from '@drauf/catalog';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/index.js';
import {
  getCatalogUsage,
  getListEntry,
  getListHouseholdId,
  listCategories,
  setCatalogUsageAsked,
  setCatalogUsageCategoryIfUnset,
  updateListEntry,
} from '../db/repositories.js';
import type { ListEntry } from '../db/schema/types.js';
import { getEntryView } from '../lists/items.js';
import { listTopic, type SyncHub } from '../sync/hub.js';
import { stampFieldTimes } from '../sync/operations.js';
import { type Categorizer, pickAnswer } from './index.js';

export interface CategorizeService {
  /**
   * Fire-and-forget: never blocks or fails the add path. The returned
   * promise is for tests; callers `void` it.
   */
  schedule(entry: ListEntry): Promise<void>;
}

/**
 * The optional third tier of category guessing (#22), out-of-band of the
 * add request: at most one call per household item (the asked marker is set
 * before the call and only cleared on transport errors, so a "none" answer
 * is never asked again), the answer is validated against the household's
 * categories, and a manual choice made in the meantime always wins.
 */
export function createCategorizeService(deps: {
  database: Database;
  hub: SyncHub;
  categorizer: Categorizer;
  catalog: CatalogIndex;
  log: FastifyBaseLogger;
}): CategorizeService {
  const inFlight = new Set<string>();

  async function run(entry: ListEntry): Promise<void> {
    const householdId = await getListHouseholdId(deps.database, entry.listId);
    if (householdId === undefined) {
      return;
    }
    const key = `${householdId}:${entry.nameNormalized}`;
    if (inFlight.has(key)) {
      return;
    }
    inFlight.add(key);
    try {
      const usage = await getCatalogUsage(deps.database, householdId, entry.nameNormalized);
      if (usage === undefined || usage.categoryId !== null || usage.categoryAskedAt !== null) {
        return;
      }
      await setCatalogUsageAsked(deps.database, householdId, entry.nameNormalized, new Date());

      const categories = await listCategories(deps.database, householdId);
      // The model is offered one token per category: the fixed key where
      // one exists, the (custom) category's name otherwise. Answers are
      // accepted by token or by category name, nothing else.
      const options = categories.map((category) => category.key ?? category.name);
      const byAnswer = new Map<string, string>();
      for (const category of categories) {
        if (category.key !== null) {
          byAnswer.set(category.key, category.id);
        }
        byAnswer.set(category.name, category.id);
      }

      let raw: string;
      try {
        raw = await deps.categorizer.guess(entry.name, options);
      } catch (err) {
        // Fail open — and let a later add retry after a transport error.
        deps.log.warn({ err }, 'LLM categorization failed');
        await setCatalogUsageAsked(deps.database, householdId, entry.nameNormalized, null);
        return;
      }
      const token = pickAnswer(raw, [...byAnswer.keys()]);
      const categoryId = token === null ? undefined : byAnswer.get(token);
      if (categoryId === undefined) {
        deps.log.info(
          { item: entry.name, answer: raw.slice(0, 200) },
          'LLM category answer discarded',
        );
        return;
      }

      await setCatalogUsageCategoryIfUnset(
        deps.database,
        householdId,
        entry.nameNormalized,
        categoryId,
      );
      // The entry may be gone or manually categorized by now — those win.
      const current = await getListEntry(deps.database, entry.listId, entry.id);
      if (current === undefined || current.categoryId !== null) {
        return;
      }
      const patch = {
        categoryId,
        fieldTimes: stampFieldTimes(current.fieldTimes, ['categoryId'], Date.now()),
      };
      await updateListEntry(deps.database, current.id, patch);
      const view = await getEntryView(deps.database, { ...current, ...patch }, deps.catalog);
      deps.hub.publish(listTopic(current.listId), { type: 'entry.updated', data: view });
    } finally {
      inFlight.delete(key);
    }
  }

  return {
    schedule(entry) {
      return run(entry).catch((err) => {
        deps.log.warn({ err }, 'LLM categorization failed');
      });
    },
  };
}
