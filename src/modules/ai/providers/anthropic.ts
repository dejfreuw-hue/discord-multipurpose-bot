import { postJson, requireText, type ChatRequest, type ChatResult, type Provider } from './types.js';

interface Response {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic' as const;

  constructor(private readonly apiKey: string) {}

  async chat(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: [
        ...(m.images ?? []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.data } })),
        { type: 'text', text: m.content },
      ],
    }));

    const data = await postJson<Response>(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      { model: request.model, max_tokens: request.maxTokens, system: request.system, messages },
      signal,
    );
    const text = data.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    return {
      text: requireText(text, data),
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }
}
