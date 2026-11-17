import { z } from 'zod';
import type { DraftShot, Idea } from './project';

const draftSchema = z.object({ shots: z.array(z.object({
  description: z.string().trim().min(1).max(4000),
  actionDialogue: z.string().max(4000),
  durationMs: z.number().int().min(100).max(600000),
})).min(5).max(10) });

export interface AIProvider {
  generateDraft(ideas: Pick<Idea, 'text' | 'tags' | 'notes'>[], model: string, key: string): Promise<DraftShot[]>;
}

export const openAIProvider: AIProvider = {
  async generateDraft(ideas, model, key) {
    if (!ideas.length || ideas.length > 30) throw new Error('请选择 1～30 张灵感卡片');
    if (!model.trim()) throw new Error('请先填写模型名称');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', signal: controller.signal,
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          text: { format: { type: 'json_schema', name: 'storyboard_draft', strict: true, schema: {
            type: 'object', additionalProperties: false, required: ['shots'], properties: {
              shots: { type: 'array', items: { type: 'object', additionalProperties: false,
                required: ['description', 'actionDialogue', 'durationMs'], properties: {
                  description: { type: 'string' }, actionDialogue: { type: 'string' }, durationMs: { type: 'integer' },
                } }, },
            },
          } } },
          input: [
            { role: 'system', content: '你是视频分镜助手。根据用户灵感生成 5 到 10 个镜头。仅返回 JSON 对象，格式为 {"shots":[{"description":"画面描述","actionDialogue":"动作或对白","durationMs":3000}]}。每个镜头时长为毫秒。不要添加解释或 Markdown。' },
            { role: 'user', content: JSON.stringify(ideas) },
          ],
        }),
      });
    } catch (error) {
      throw new Error(controller.signal.aborted ? 'AI 请求超时，请检查网络后重试' : `AI 网络请求失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}；请检查密钥、模型与额度`);
    const body = await response.json() as { status?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = body.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('') || '';
    if (!text) throw new Error('AI 未返回文字草案，请重试或更换模型');
    try { return draftSchema.parse(JSON.parse(text)).shots; }
    catch { throw new Error('AI 返回的分镜格式不符合要求；已有分镜未修改'); }
  },
};
