import { postJson, requireText, type ChatRequest, type ChatResult, type Provider } from './types.js';

interface Response {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export class GeminiProvider implements Provider {
  readonly name = 'gemini' as const;

  constructor(private readonly apiKey: string) {}

  async chat(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
    const contents = request.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [...(m.images ?? []).map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } })), { text: m.content }],
    }));

    const data = await postJson<Response>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
      { 'x-goog-api-key': this.apiKey },
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents,
        generationConfig: { maxOutputTokens: request.maxTokens },
      },
      signal,
    );
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    const usage = data.usageMetadata;
    return {
      text: requireText(text, data),
      inputTokens: usage?.promptTokenCount ?? 0,
      // Thinking models bill their reasoning as output, so it counts against the budget too.
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    };
  }
}
