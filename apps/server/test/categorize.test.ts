import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anthropicCategorizer } from '../src/categorize/anthropic.js';
import { type Categorizer, pickAnswer } from '../src/categorize/index.js';
import { openAiCategorizer } from '../src/categorize/openai.js';
import type { Category } from '../src/db/schema/types.js';
import type { EntryView } from '../src/lists/items.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('pickAnswer (strict output contract)', () => {
  const options = ['drinks', 'bread-bakery', 'Getränkemarkt'];

  it('accepts the German category name as an answer too', () => {
    expect(pickAnswer('Getränkemarkt', options)).toBe('Getränkemarkt');
  });

  it('accepts exact tokens, case-insensitively, with quotes and periods stripped', () => {
    expect(pickAnswer('drinks', options)).toBe('drinks');
    expect(pickAnswer('  Drinks.\n', options)).toBe('drinks');
    expect(pickAnswer('"bread-bakery"', options)).toBe('bread-bakery');
    expect(pickAnswer('getränkemarkt', options)).toBe('Getränkemarkt');
  });

  it('discards none, empty and free-text answers', () => {
    expect(pickAnswer('none', options)).toBeNull();
    expect(pickAnswer('', options)).toBeNull();
    expect(pickAnswer('I think drinks fits best', options)).toBeNull();
    expect(pickAnswer('beverages', options)).toBeNull();
  });
});

describe('anthropic categorizer', () => {
  it('sends one classification request and validates the answer', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: 'drinks' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const categorizer = anthropicCategorizer({
      apiKey: 'test-key',
      model: 'claude-opus-5-5',
      fetch: fakeFetch,
    });

    const answer = await categorizer.guess('Spezi', ['drinks', 'snacks']);
    expect(answer.trim()).toBe('drinks');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(requests[0]?.init.body)) as {
      model: string;
      messages: Array<{ content: string }>;
      output_config: { effort: string };
    };
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.messages[0]?.content).toContain('Spezi');
    expect(body.messages[0]?.content).toContain('drinks');
  });
});

describe('openai-compatible categorizer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls chat/completions without auth for local endpoints', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ choices: [{ message: { content: ' Drinks ' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const categorizer = openAiCategorizer({
      baseUrl: 'http://ollama.local:11434/v1',
      apiKey: undefined,
      model: 'qwen3:8b',
    });

    const answer = await categorizer.guess('Spezi', ['drinks', 'snacks']);
    expect(answer).toBe(' Drinks ');
    expect(requests[0]?.url).toBe('http://ollama.local:11434/v1/chat/completions');
    const headers = requests[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(String(requests[0]?.init.body)) as { model: string };
    expect(body.model).toBe('qwen3:8b');
  });

  it('treats error statuses as a failed call', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
    const categorizer = openAiCategorizer({
      baseUrl: 'http://ollama.local:11434/v1',
      apiKey: undefined,
      model: 'qwen3:8b',
    });
    await expect(categorizer.guess('Spezi', ['drinks'])).rejects.toThrow('500');
  });
});

describe('categorization service (via the add path)', () => {
  let ctx: TestApp;
  let headers: { authorization: string };
  let listId: string;
  let calls: string[][];
  let answer: () => Promise<string>;

  const fake: Categorizer = {
    guess: (name, options) => {
      calls.push([name, ...options]);
      return answer();
    },
  };

  beforeEach(async () => {
    calls = [];
    answer = () => Promise.resolve('drinks');
    ctx = await createTestApp({}, { categorizer: fake });
    await createLocalUser(ctx.database, {
      username: 'christian',
      password: PASSWORD,
      displayName: 'Christian',
      isAdmin: false,
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'christian', password: PASSWORD },
    });
    headers = {
      authorization: `Bearer ${(login.json() as { accessToken: string }).accessToken}`,
    };
    const list = await ctx.app.inject({
      method: 'POST',
      url: '/api/lists',
      headers,
      payload: { name: 'Weekly shop' },
    });
    listId = (list.json() as { id: string }).id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function addItem(name: string): Promise<EntryView> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers,
      payload: { name },
    });
    expect([200, 201]).toContain(response.statusCode);
    return response.json();
  }

  async function getEntry(entryId: string): Promise<EntryView | undefined> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/lists/${listId}/entries`,
      headers,
    });
    return (response.json() as EntryView[]).find((entry) => entry.id === entryId);
  }

  async function categoryIdByKey(key: string): Promise<string> {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/categories', headers });
    const categories = response.json() as Category[];
    const id = categories.find((category) => category.key === key)?.id;
    if (id === undefined) throw new Error(`no category with key ${key}`);
    return id;
  }

  it('fills in the guessed category out-of-band and asks only once per name', async () => {
    const created = await addItem('Zaubertrank');
    // The add path answers immediately, without the category — but with
    // the transient hint that a guess is running (#60).
    expect(created.categoryId).toBeNull();
    expect(created.categorizing).toBe(true);

    const drinks = await categoryIdByKey('drinks');
    await vi.waitFor(async () => {
      expect((await getEntry(created.id))?.categoryId).toBe(drinks);
    });
    // The stored view never carries the transient flag.
    expect((await getEntry(created.id))?.categorizing).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('Zaubertrank');
    expect(calls[0]).toContain('drinks');

    // Re-adding merges and keeps the learned category without a second call.
    await addItem('Zaubertrank');
    expect(calls).toHaveLength(1);
  });

  it('never asks for items the catalogue already places', async () => {
    const created = await addItem('Milch');
    expect(created.categoryId).not.toBeNull();
    expect(created.categorizing).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);
  });

  it('discards invalid answers and does not ask the same name again', async () => {
    answer = () => Promise.resolve('keine Ahnung, vielleicht Gewürze?');
    const created = await addItem('Omas Geheimgewürz');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await getEntry(created.id))?.categoryId).toBeNull();

    // The "none" answer is remembered: a fresh add does not ask again.
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${listId}/entries/${created.id}`,
      headers,
    });
    await addItem('Omas Geheimgewürz');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
  });

  it('fails open on errors and allows a retry on the next add', async () => {
    answer = () => Promise.reject(new Error('timeout'));
    const created = await addItem('Zaubertrank');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect((await getEntry(created.id))?.categoryId).toBeNull();

    // A transport error is not an answer: the next add may ask again.
    answer = () => Promise.resolve('drinks');
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${listId}/entries/${created.id}`,
      headers,
    });
    const readded = await addItem('Zaubertrank');
    const drinks = await categoryIdByKey('drinks');
    await vi.waitFor(async () => {
      expect((await getEntry(readded.id))?.categoryId).toBe(drinks);
    });
    expect(calls).toHaveLength(2);
  });
});
