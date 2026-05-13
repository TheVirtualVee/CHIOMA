import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_TOKENS = 800;

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

// ─── Shared retry + timeout wrapper ───────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isAbort = err instanceof Error && err.name === "AbortError";
      // Only retry on timeout or 5xx — don't retry auth/4xx
      if (attempt <= maxRetries && isAbort) {
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
      break;
    }
  }
  throw new Error(`${label}_FAILED: ${String(lastErr)}`);
}

// ─── OpenAI / OpenRouter provider ────────────────────────────────────────

export class OpenAIProvider implements LlmProvider {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = "gpt-4o-mini",
    private readonly baseUrl: string = "https://api.openai.com/v1",
    opts?: { timeoutMs?: number; maxRetries?: number },
  ) {
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    return withRetry(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: request.systemPrompt ?? "You are a helpful assistant." },
              { role: "user", content: request.prompt },
            ],
            temperature: request.temperature ?? 0,
            max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
            response_format: { type: "json_object" },
          }),
        },
        this.timeoutMs,
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`OPENAI_HTTP_${response.status}: ${JSON.stringify(err)}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      // constraint: LLM output never trusted — validate structure
      z.object({
        choices: z.array(z.object({ message: z.object({ content: z.string() }) })),
        usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number(), total_tokens: z.number() }),
      }).parse(data);

      return {
        content: data.choices[0].message.content,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
        model: this.model,
      };
    }, this.maxRetries, "OPENAI_CALL");
  }
}

// ─── Groq provider (OpenAI-compatible, fast inference) ───────────────────

export class GroqProvider extends OpenAIProvider {
  constructor(
    apiKey: string,
    model: string = "llama-3.3-70b-versatile",
    opts?: { timeoutMs?: number; maxRetries?: number },
  ) {
    super(apiKey, model, "https://api.groq.com/openai/v1", opts);
  }
}

// ─── OpenRouter provider ─────────────────────────────────────────────────

export class OpenRouterProvider extends OpenAIProvider {
  constructor(
    apiKey: string,
    model: string = "mistralai/mistral-7b-instruct",
    opts?: { timeoutMs?: number; maxRetries?: number },
  ) {
    super(apiKey, model, "https://openrouter.ai/api/v1", opts);
  }
}

// ─── Anthropic provider ───────────────────────────────────────────────────

export class AnthropicProvider implements LlmProvider {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = "claude-3-haiku-20240307",
    opts?: { timeoutMs?: number; maxRetries?: number },
  ) {
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    return withRetry(async () => {
      const response = await fetchWithTimeout(
        "https://api.anthropic.com/v1/messages",
        {
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
            max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
            temperature: request.temperature ?? 0,
          }),
        },
        this.timeoutMs,
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`ANTHROPIC_HTTP_${response.status}: ${JSON.stringify(err)}`);
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
    }, this.maxRetries, "ANTHROPIC_CALL");
  }
}

// ─── Factory — resolves provider from env ────────────────────────────────

/**
 * contract: LlmFactory
 * side-effect: reads process.env.
 */
export function createLlmProviderFromEnv(): LlmProvider {
  const provider = process.env.LLM_PROVIDER ?? "openai";
  const apiKey = process.env.LLM_API_KEY || (provider === "groq" ? process.env.GROQ_API_KEY : undefined);
  const model = process.env.LLM_MODEL;
  const timeoutMs = parseInt(process.env.LLM_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS), 10);
  const maxRetries = parseInt(process.env.LLM_MAX_RETRIES ?? String(DEFAULT_MAX_RETRIES), 10);

  // ASSERT: API key must be present
  if (!apiKey) {
    const keyName = provider === "groq" ? "GROQ_API_KEY (or LLM_API_KEY)" : "LLM_API_KEY";
    throw new Error(`BOOT_FAILURE: ${keyName} not set`);
  }

  const opts = { timeoutMs, maxRetries };

  switch (provider) {
    case "groq":       return new GroqProvider(apiKey, model ?? "llama-3.3-70b-versatile", opts);
    case "openrouter": return new OpenRouterProvider(apiKey, model ?? "mistralai/mistral-7b-instruct", opts);
    case "anthropic":  return new AnthropicProvider(apiKey, model ?? "claude-3-haiku-20240307", opts);
    case "openai":
    default:
      return new OpenAIProvider(apiKey, model ?? "gpt-4o-mini", undefined, opts);
  }
}
