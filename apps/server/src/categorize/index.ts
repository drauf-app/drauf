import type { CategorizeConfig } from '../config.js';
import { anthropicCategorizer } from './anthropic.js';
import { openAiCategorizer } from './openai.js';

/**
 * Optional LLM category guessing (#22): asked only when the household's
 * history and the deterministic catalogue matcher both found nothing.
 */
export interface Categorizer {
  /** Returns the model's raw answer; the service validates and logs it. */
  guess(name: string, options: string[]): Promise<string>;
}

const SYSTEM_PROMPT =
  'You assign German grocery shopping items to store categories. ' +
  'Answer with exactly one category token from the offered list, or the word ' +
  'none when no category fits or you are unsure. Answer with the token only — ' +
  'no explanation, no punctuation.';

export function buildUserPrompt(name: string, options: string[]): string {
  return `Categories:\n${options.join('\n')}\n\nItem: ${name}`;
}

/**
 * Strict output contract: the (trimmed, unquoted) answer must be one of the
 * offered tokens — compared case-insensitively — anything else counts as
 * "none" and is discarded.
 */
export function pickAnswer(text: string, options: string[]): string | null {
  const answer = text
    .trim()
    .replace(/^["'„“]+|["'“”.]+$/g, '')
    .trim()
    .toLowerCase();
  return options.find((option) => option.toLowerCase() === answer) ?? null;
}

export { SYSTEM_PROMPT };

export function createCategorizer(
  config: CategorizeConfig | undefined,
  model?: () => Promise<string>,
): Categorizer | undefined {
  if (config === undefined) {
    return undefined;
  }
  const resolveModel = model ?? (() => Promise.resolve(config.model));
  return config.provider === 'anthropic'
    ? anthropicCategorizer({ apiKey: config.apiKey, model: resolveModel })
    : openAiCategorizer({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: resolveModel });
}
