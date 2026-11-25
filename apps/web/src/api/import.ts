import { apiJson } from '../auth/store';
import type { EntryView, PlanEntry } from './types';

export interface PreviewIngredient {
  /** The provider's raw ingredient line, kept for display fallbacks. */
  raw: string;
  name: string;
  quantity?: number;
  unit?: string;
  /** Staples (salt, oil, …) start deselected in the preview. */
  isStaple: boolean;
}

export interface ImportPreview {
  provider: string;
  url: string;
  title: string | null;
  imageUrl: string | null;
  servings: number | null;
  ingredients: PreviewIngredient[];
}

export interface ApplyItem {
  name: string;
  quantity?: number;
  unit?: string;
  note?: string;
  categoryId?: string;
}

export interface ApplyInput {
  list?: { id: string; items: ApplyItem[] };
  plan?: { date: string; slotId?: string; title?: string; link: string; imageUrl?: string };
}

export interface ApplyResult {
  entries: EntryView[];
  planEntry?: PlanEntry;
}

export function previewImport(input: string): Promise<ImportPreview> {
  return apiJson<ImportPreview>('/api/import/preview', {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
}

export function applyImport(input: ApplyInput): Promise<ApplyResult> {
  return apiJson<ApplyResult>('/api/import/apply', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Same-origin proxy URL for a recipe image (clients never contact third parties). */
export function proxiedImageUrl(imageUrl: string): string {
  return `/api/import/image?url=${encodeURIComponent(imageUrl)}`;
}
