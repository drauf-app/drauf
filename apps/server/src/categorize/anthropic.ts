import Anthropic from '@anthropic-ai/sdk';
import { buildUserPrompt, type Categorizer, SYSTEM_PROMPT } from './index.js';

/** One small classification call; callers treat every failure as "none". */
export function anthropicCategorizer(config: {
  apiKey: string;
  /** Resolved per call: the model is a runtime setting (#73). */
  model: () => Promise<string>;
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
        model: await config.model(),
        // Room for adaptive thinking; the answer itself is a single token.
        max_tokens: 1024,
        output_config: { effort: 'low' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(name, options) }],
      });
      return response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    },
  };
}
