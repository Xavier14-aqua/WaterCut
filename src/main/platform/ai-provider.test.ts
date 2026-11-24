import { afterEach, expect, test, vi } from 'vitest';
import { openAIProvider } from './ai-provider';
afterEach(() => vi.restoreAllMocks());
test('AI draft is validated before it can be shown', async () => {
  const shots = Array.from(
    {
      length: 5,
    },
    (_, index) => ({
      description: `镜头 ${index}`,
      actionDialogue: '',
      durationMs: 3000,
    }),
  );
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                shots,
              }),
            },
          ],
        },
      ],
    }),
  );
  expect(
    await openAIProvider.generateDraft(
      [
        {
          text: '雨夜',
          tags: '',
          notes: '',
        },
      ],
      'test-model',
      'fake-key',
    ),
  ).toEqual(shots);
  const body = JSON.parse(String(request.mock.calls[0][1]?.body));
  expect(body.text.format.type).toBe('json_schema');
  expect(body.input[1].content).toContain('雨夜');
});
test('invalid AI response fails without a draft', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: '{"shots":[]}',
            },
          ],
        },
      ],
    }),
  );
  await expect(
    openAIProvider.generateDraft(
      [
        {
          text: '雨夜',
          tags: '',
          notes: '',
        },
      ],
      'test-model',
      'fake-key',
    ),
  ).rejects.toThrow('格式不符合要求');
});
test('AI requests contain only the disclosed text fields, without library IDs or media references', async () => {
  const shots = Array.from(
    {
      length: 5,
    },
    () => ({
      description: '画面',
      actionDialogue: '',
      durationMs: 1000,
    }),
  );
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                shots,
              }),
            },
          ],
        },
      ],
    }),
  );
  const privateIdea = {
    text: '公开选择的文字',
    tags: '雨后',
    notes: '备注',
    sourceLibraryId: 'private-library',
    media: [
      {
        assetId: 'private-media',
      },
    ],
    payload: {
      location: 'private-location',
    },
  };
  await openAIProvider.generateDraft([privateIdea], 'test-model', 'fake-key');
  const body = JSON.parse(String(request.mock.calls[0][1]?.body));
  expect(JSON.parse(body.input[1].content)).toEqual([
    {
      text: privateIdea.text,
      tags: privateIdea.tags,
      notes: privateIdea.notes,
    },
  ]);
});
