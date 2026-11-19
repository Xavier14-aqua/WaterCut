import { z } from 'zod';
import type { DraftShot, Idea } from './project';
import { responseSchema,type ProposalKind,type AITextInput } from './shared/ai-proposals';
const draftSchema = z.object({
  shots: z.array(z.object({
    description: z.string().trim().min(1).max(4000),
    actionDialogue: z.string().max(4000),
    durationMs: z.number().int().min(100).max(600000)
  })).min(5).max(10)
});
export interface AIProvider {
  suggest?:(kind:ProposalKind,input:AITextInput,model:string,key:string,signal?:AbortSignal)=>Promise<unknown>;
  generateDraft(ideas: Pick<Idea, 'text' | 'tags' | 'notes'>[], model: string, key: string): Promise<DraftShot[]>;
}
export const openAIProvider: AIProvider = {
  suggest:generateSuggestions,
  async generateDraft(ideas, model, key) {
    if (!ideas.length || ideas.length > 30) throw new Error('请选择 1～30 张灵感卡片');
    if (!model.trim()) throw new Error('请先填写模型名称');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          text: {
            format: {
              type: 'json_schema',
              name: 'storyboard_draft',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['shots'],
                properties: {
                  shots: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['description', 'actionDialogue', 'durationMs'],
                      properties: {
                        description: {
                          type: 'string'
                        },
                        actionDialogue: {
                          type: 'string'
                        },
                        durationMs: {
                          type: 'integer'
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          input: [{
            role: 'system',
            content: '你是视频分镜助手。根据用户灵感生成 5 到 10 个镜头。仅返回 JSON 对象，格式为 {"shots":[{"description":"画面描述","actionDialogue":"动作或对白","durationMs":3000}]}。每个镜头时长为毫秒。不要添加解释或 Markdown。'
          }, {
            role: 'user',
            content: JSON.stringify(ideas.map(({
              text,
              tags,
              notes
            }) => ({
              text,
              tags,
              notes
            })))
          }]
        })
      });
    } catch (error) {
      throw new Error(controller.signal.aborted ? 'AI 请求超时，请检查网络后重试' : `AI 网络请求失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}；请检查密钥、模型与额度`);
    const body = (await response.json()) as {
      status?: string;
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
    };
    const text = body.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('') || '';
    if (!text) throw new Error('AI 未返回文字草案，请重试或更换模型');
    try {
      return draftSchema.parse(JSON.parse(text)).shots;
    } catch {
      throw new Error('AI 返回的分镜格式不符合要求；已有分镜未修改');
    }
  }
};
export async function generateSuggestions(kind:ProposalKind,input:AITextInput,model:string,key:string,signal?:AbortSignal):Promise<unknown>{
  if(!model.trim())throw new Error('请先填写模型名称');
  const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)controller.abort();const timeout=setTimeout(cancel,60000);
  const prompts={outline:'根据所选灵感给出 2～3 条不同的故事路线，每条有标题、简述和 3～10 个镜头。不要修改输入，所有结果仅是待确认建议。',visual:'针对输入镜头的动作/对白提出画面、景别和运镜建议，每个输入镜头最多一条。shotKey 必须引用输入的 key。',review:'检查输入分镜的逻辑、景别、节奏与缺口，仅提供解释和建议。shotKey 必须引用输入 key；适合补镜时给 insertShot，否则为 null。不要删除或重写输入镜头。'};
  const schema:any=z.toJSONSchema(responseSchema(kind));delete schema.$schema;
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,text:{format:{type:'json_schema',name:`watercut_${kind}`,strict:true,schema}},input:[{role:'system',content:prompts[kind]},{role:'user',content:JSON.stringify(input)}]})});
    if(!response.ok)throw new Error(`AI 服务返回 HTTP ${response.status}，请检查密钥、模型和额度`);
    const reader=response.body?.getReader();if(!reader)throw new Error('AI 未返回响应正文');let size=0;const decoder=new TextDecoder();let body='';while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024*1024){await reader.cancel();throw new Error('AI 响应超过 1 MB，请缩小输入范围');}body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();
    const data=JSON.parse(body),text=(data.output??[]).flatMap((item:any)=>item.content??[]).filter((item:any)=>item.type==='output_text').map((item:any)=>item.text??'').join('');if(!text)throw new Error('AI 未返回建议文字，请更换模型或重试');return responseSchema(kind).parse(JSON.parse(text));
  }catch(error){if(controller.signal.aborted)throw new Error(signal?.aborted?'AI 请求已取消，正式项目未修改':'AI 请求超时，正式项目未修改');if(error instanceof z.ZodError||error instanceof SyntaxError)throw new Error('AI 返回结构不符合要求，正式项目未修改');throw error;
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
}
