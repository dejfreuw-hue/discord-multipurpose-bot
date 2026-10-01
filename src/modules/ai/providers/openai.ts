import { postJson, requireText, type ChatRequest, type ChatResult, type Provider, type ProviderName } from './types.js';

interface Response {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * OpenAI's Chat Completions API, also used for every OpenAI-compatible server
 * (OpenRouter, Groq, Together, Ollama, LM Studio and so on).
 */
export class OpenAIProvider implements Provider {
  constructor(
    readonly name: Extract<ProviderName, 'openai' | 'compatible'>,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async chat(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
    const messages = [
      { role: 'system', content: request.system },
      ...request.messages.map((m) => ({
        role: m.role,
        content: m.images?.length
          ? [
              { type: 'text', text: m.content },
              ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.data}` } })),
            ]
          : m.content,
      })),
    ];
    // Newer OpenAI models reject max_tokens, while most compatible servers only know max_tokens.
    const limit = this.name === 'openai' ? { max_completion_tokens: request.maxTokens } : { max_tokens: request.maxTokens };
    const headers: Record<string, string> = this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};

    const data = await postJson<Response>(
      `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      headers,
      { model: request.model, messages, ...limit },
      signal,
    );
    return {
      text: requireText(data.choices?.[0]?.message?.content ?? undefined, data),
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}
