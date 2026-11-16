import { buildUserPrompt, type Categorizer, SYSTEM_PROMPT } from './index.js';

/**
 * Any OpenAI-compatible chat-completions endpoint — which includes locally
 * running models (Ollama, LM Studio, vLLM expose the same API), so item
 * names can stay on-site. The API key is optional for such local servers.
 */
export function openAiCategorizer(config: {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}): Categorizer {
  return {
    async guess(name, options) {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey !== undefined && config.apiKey !== ''
            ? { authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          max_tokens: 64,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(name, options) },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`categorize endpoint answered ${response.status}`);
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      return body.choices?.[0]?.message?.content ?? '';
    },
  };
}
