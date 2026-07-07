import { afterEach, describe, expect, it, vi } from "vitest";
import { callChat, extractFirstJsonObject, type EndpointConfig } from "./LLMClient";

const cfg: EndpointConfig = {
  label: "test",
  baseUrl: "https://api.example.com/v1",
  apiKey: "k",
  model: "reasoner",
  useProxy: false,
  costInPerM: 0,
  costOutPerM: 0,
};

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => vi.restoreAllMocks());

describe("LLMClient reasoning-model handling", () => {
  const opts = { temperature: 0, timeoutMs: 5000 };

  it("falls back to reasoning_content when content is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse({
          choices: [{ message: { content: "", reasoning_content: '{"action":{"move":"reload"}}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 250 },
        }),
      ),
    );
    const r = await callChat(cfg, [{ role: "user", content: "go" }], opts);
    expect(r.parseError).toBeNull();
    expect(r.parsed?.action).toEqual({ move: "reload" });
    // usage is counted even though it came from the fallback field
    expect(r.promptTokens).toBe(100);
    expect(r.completionTokens).toBe(250);
  });

  it("empty content is a SOFT error carrying real usage, not a thrown exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse({
          choices: [{ message: { content: "" }, finish_reason: "length" }],
          usage: { prompt_tokens: 1500, completion_tokens: 1024 },
        }),
      ),
    );
    const r = await callChat(cfg, [{ role: "user", content: "go" }], opts);
    expect(r.parsed).toBeNull();
    expect(r.parseError).toMatch(/max output token/i); // truncation hint from finish_reason
    // the cost of the wasted call is still recorded (the previous bug lost this)
    expect(r.promptTokens).toBe(1500);
    expect(r.completionTokens).toBe(1024);
    expect(r.estimatedTokens).toBe(false);
  });

  it("still parses normal content responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse({
          choices: [{ message: { content: 'Here you go: {"action":{"move":"shoot"}}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 8 },
        }),
      ),
    );
    const r = await callChat(cfg, [{ role: "user", content: "go" }], opts);
    expect(r.parsed?.action).toEqual({ move: "shoot" });
  });

  it("sends the configured per-endpoint maxTokens", async () => {
    const spy = vi.fn(async () =>
      mockResponse({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    );
    vi.stubGlobal("fetch", spy);
    await callChat({ ...cfg, maxTokens: 8000 }, [{ role: "user", content: "go" }], opts);
    const call = spy.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(call[1].body as string);
    expect(sent.max_tokens).toBe(8000);
  });
});

describe("extractFirstJsonObject", () => {
  it("pulls JSON out of prose and code fences", () => {
    expect(extractFirstJsonObject('prefix {"a":1} suffix')).toBe('{"a":1}');
    expect(extractFirstJsonObject('```json\n{"a":{"b":2}}\n```')).toBe('{"a":{"b":2}}');
    expect(extractFirstJsonObject('{"s":"has } brace in string"}')).toBe('{"s":"has } brace in string"}');
    expect(extractFirstJsonObject("no json here")).toBeNull();
  });
});
