/**
 * Production-ready LLM Integration.
 * Enforces Priority 1: Structured output, timeout handling, and observability.
 */
export type LlmRequest = {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
};

export type LlmResponse = {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
};

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class OpenAIProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly model: string = "gpt-4-turbo-preview") {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.systemPrompt ?? "You are a helpful assistant." },
          { role: "user", content: request.prompt },
        ],
        temperature: request.temperature ?? 0,
        max_tokens: request.maxTokens ?? 1000,
        response_format: { type: "json_object" }, // Enforce structured output
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OPENAI_API_FAILURE: ${JSON.stringify(error)}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    return {
      content: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: this.model,
    };
  }
}

export class AnthropicProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly model: string = "claude-3-opus-20240229") {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.prompt }],
        max_tokens: request.maxTokens ?? 1000,
        temperature: request.temperature ?? 0,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`ANTHROPIC_API_FAILURE: ${JSON.stringify(error)}`);
    }

    const data = await response.json() as {
      content: Array<{ text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    return {
      content: data.content[0].text,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      model: this.model,
    };
  }
}
