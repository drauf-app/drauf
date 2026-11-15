import Anthropic from '@anthropic-ai/sdk';
import { buildUserPrompt, type Categorizer, pickAnswer, SYSTEM_PROMPT } from './index.js';

/** One small classification call; callers treat every failure as "none". */
export function anthropicCategorizer(config: {
  apiKey: string;
  model: string;
  /** Test seam for the SDK's HTTP layer. */
  fetch?: typeof globalThis.fetch;
}): Categorizer {
  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: 15_000,
    ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
  });
  return {
    async guess(name, options) {
      const response = await client.messages.create({
        model: config.model,
        // Room for adaptive thinking; the answer itself is a single token.
        max_tokens: 1024,
        output_config: { effort: 'low' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(name, options) }],
      });
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return pickAnswer(text, options);
    },
  };
}
