import { afterEach, expect, test, vi } from 'vitest';
import { openAIProvider } from './ai';

afterEach(() => vi.restoreAllMocks());

test('AI draft is validated before it can be shown', async () => {
  const shots = Array.from({ length: 5 }, (_, index) => ({ description: `镜头 ${index}`, actionDialogue: '', durationMs: 3000 }));
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ shots }) }] }] }));
  expect(await openAIProvider.generateDraft([{ text: '雨夜', tags: '', notes: '' }], 'test-model', 'fake-key')).toEqual(shots);
  const body = JSON.parse(String(request.mock.calls[0][1]?.body));
  expect(body.text.format.type).toBe('json_schema');
  expect(body.input[1].content).toContain('雨夜');
});

test('invalid AI response fails without a draft', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ output: [{ content: [{ type: 'output_text', text: '{"shots":[]}' }] }] }));
  await expect(openAIProvider.generateDraft([{ text: '雨夜', tags: '', notes: '' }], 'test-model', 'fake-key')).rejects.toThrow('格式不符合要求');
});
