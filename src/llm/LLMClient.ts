// LLMClient (§4.1): builds OpenAI-compatible requests, times them, tolerantly
// extracts the JSON envelope from the model output, and reads token usage
// (with a chars/4 estimate fallback flagged as `estimated`).

import type { Action } from "../engine/GameEngine";

export interface EndpointConfig {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  useProxy: boolean;
  costInPerM: number; // USD per 1M input tokens (0 = unknown)
  costOutPerM: number;
  maxTokens?: number; // output budget; reasoning models need generous headroom
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ParsedEnvelope {
  reasoning?: string;
  action?: Action;
  notes?: string;
  [key: string]: unknown;
}

export interface LLMCallResult {
  parsed: ParsedEnvelope | null;
  parseError: string | null;
  raw: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  estimatedTokens: boolean;
}

export type LLMErrorKind = "cors-or-network" | "http" | "timeout" | "aborted" | "bad-response";

export class LLMError extends Error {
  kind: LLMErrorKind;
  status?: number;
  constructor(kind: LLMErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export const DEFAULT_PROXY_BASE = "http://localhost:8787";

function endpointUrl(cfg: EndpointConfig, path: string): string {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const target = `${base}${path}`;
  if (cfg.useProxy) {
    return `${DEFAULT_PROXY_BASE}/proxy?target=${encodeURIComponent(target)}`;
  }
  return target;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// Tolerant extraction: prefer a fenced ```json block, else scan the whole text
// for the first balanced {...} object (string-aware).
export function extractFirstJsonObject(text: string): string | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = fence ? [fence[1], text] : [text];
  for (const t of candidates) {
    const start = t.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) return t.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

interface CallOptions {
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
  jsonMode?: boolean;
}

async function rawFetch(
  cfg: EndpointConfig,
  body: Record<string, unknown>,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new LLMError("timeout", `Decision timeout after ${timeoutMs}ms`)), timeoutMs);
  const onExternalAbort = () => ctrl.abort(new LLMError("aborted", "Match aborted"));
  external?.addEventListener("abort", onExternalAbort, { once: true });
  try {
    return await fetch(endpointUrl(cfg, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof LLMError) throw ctrl.signal.reason;
    // fetch TypeError = network failure or CORS block
    throw new LLMError(
      "cors-or-network",
      `Network request failed — this endpoint may not allow browser requests (CORS). ` +
        `Try enabling "Route through local proxy" for this player (run: npm run proxy). Original: ${String(e)}`,
    );
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }
}

export async function callChat(
  cfg: EndpointConfig,
  messages: ChatMessage[],
  opts: CallOptions,
): Promise<LLMCallResult> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens ?? cfg.maxTokens ?? 4096,
    ...(opts.jsonMode !== false ? { response_format: { type: "json_object" } } : {}),
  };

  const t0 = performance.now();
  let res = await rawFetch(cfg, body, opts.timeoutMs, opts.signal);

  // Provider rejects response_format? Retry once without it.
  if (res.status === 400 && body.response_format) {
    delete body.response_format;
    res = await rawFetch(cfg, body, opts.timeoutMs, opts.signal);
  }

  // Rate limit: backoff + one extra retry outside the move-retry budget (§13).
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after")) || 2;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 15) * 1000));
    res = await rawFetch(cfg, body, opts.timeoutMs, opts.signal);
  }

  const latencyMs = Math.round(performance.now() - t0);

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    throw new LLMError("http", `HTTP ${res.status} from ${cfg.label || cfg.model}: ${detail}`, res.status);
  }

  let data: {
    choices?: { message?: { content?: string; reasoning_content?: string; reasoning?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    data = await res.json();
  } catch {
    throw new LLMError("bad-response", "Response was not valid JSON (not an OpenAI-compatible endpoint?)");
  }

  const choice = data.choices?.[0];
  const message = choice?.message;
  // Reasoning models (e.g. DeepSeek reasoner, o-series style) may leave `content`
  // empty and put text in `reasoning_content` / `reasoning`. Fall back to those
  // so we can still find the JSON envelope instead of discarding the turn.
  const raw = message?.content?.trim() || message?.reasoning_content?.trim() || message?.reasoning?.trim() || "";

  // Read usage FIRST, so tokens/cost are counted even when the content is empty
  // (those calls still hit the provider and are billed).
  let promptTokens = data.usage?.prompt_tokens ?? 0;
  let completionTokens = data.usage?.completion_tokens ?? 0;
  let estimated = false;
  if (!data.usage || (promptTokens === 0 && completionTokens === 0)) {
    estimated = true;
    promptTokens = estimateTokens(messages.map((m) => m.content).join("\n"));
    completionTokens = estimateTokens(raw);
  }

  let parsed: ParsedEnvelope | null = null;
  let parseError: string | null = null;
  if (!raw) {
    // Empty content is now a SOFT error: recorded with real usage and retried by
    // the MatchController, rather than a hard exception that hides the cost.
    // A truncated reasoning response (hit max_tokens mid-think) is the usual cause.
    parseError =
      choice?.finish_reason === "length"
        ? `Response was empty because it hit the max output token limit (likely spent on reasoning). Answer concisely — put only the JSON object, no long reasoning.`
        : `Response had empty content (no content/reasoning_content). Return a single JSON object with your action.`;
  } else {
    const jsonText = extractFirstJsonObject(raw);
    if (!jsonText) {
      parseError = "No JSON object found in the response. Respond with a single JSON object.";
    } else {
      try {
        parsed = JSON.parse(jsonText) as ParsedEnvelope;
      } catch (e) {
        parseError = `JSON.parse failed: ${String(e)}. Respond with one valid JSON object.`;
      }
    }
  }

  return { parsed, parseError, raw, promptTokens, completionTokens, latencyMs, estimatedTokens: estimated };
}

// 1-token ping for the setup screen's "Test connection" button.
export async function testConnection(
  cfg: EndpointConfig,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = performance.now();
  try {
    await callChat(cfg, [{ role: "user", content: "ping" }], {
      temperature: 0,
      maxTokens: 1,
      timeoutMs: 15000,
      jsonMode: false,
    });
    return { ok: true, latencyMs: Math.round(performance.now() - t0) };
  } catch (e) {
    return { ok: false, latencyMs: Math.round(performance.now() - t0), error: e instanceof Error ? e.message : String(e) };
  }
}

// Optional "Fetch models" helper (GET {baseUrl}/models).
export async function fetchModels(cfg: EndpointConfig): Promise<string[]> {
  const res = await fetch(endpointUrl(cfg, "/models"), {
    headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
  }).catch((e) => {
    throw new LLMError("cors-or-network", `Could not fetch models: ${String(e)}`);
  });
  if (!res.ok) throw new LLMError("http", `HTTP ${res.status} fetching models`, res.status);
  const data = (await res.json()) as { data?: { id?: string }[] };
  return (data.data ?? []).map((m) => String(m.id)).filter(Boolean);
}

export function costOf(cfg: EndpointConfig, tokensIn: number, tokensOut: number): number {
  return (tokensIn * cfg.costInPerM + tokensOut * cfg.costOutPerM) / 1_000_000;
}
