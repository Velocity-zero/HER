import test from "node:test";
import assert from "node:assert/strict";
import { LLMRouter, formatMigrationAuditLog } from "../../src/lib/providers/Router";
import { ChatProvider, ProviderCapabilities } from "../../src/lib/providers/types";
import { ModelMessage } from "../../src/lib/types";

class MockFailingProvider implements ChatProvider {
  public providerName = "mock_failing";
  public modelName = "mock/fail-v1";
  public capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsVision: false,
    supportsJsonMode: true,
    supportsReasoning: false,
    supportsFunctionCalling: false,
    supportsToolUse: false,
  };

  public async generate(): Promise<string> {
    throw new Error("Primary connection timeout (504)");
  }

  public async *stream(): AsyncGenerator<string> {
    throw new Error("Primary SSE stream disconnected");
  }
}

class MockSuccessProvider implements ChatProvider {
  public providerName = "mock_success";
  public modelName = "mock/success-v1";
  public capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsReasoning: true,
    supportsFunctionCalling: true,
    supportsToolUse: true,
  };

  public async generate(): Promise<string> {
    return "Hello from fallback provider!";
  }

  public async *stream(): AsyncGenerator<string> {
    yield "Hello ";
    yield "from ";
    yield "fallback ";
    yield "stream!";
  }
}

test("Provider Router — Capability Detection & Registration", () => {
  const router = new LLMRouter();
  const opencode = router.getProvider("opencode");
  const nvidia = router.getProvider("nvidia");

  assert.ok(opencode, "OpenCode Zen provider must be registered");
  assert.ok(nvidia, "NVIDIA provider must be registered");
  assert.equal(opencode?.modelName, (process.env.OPENCODE_ZEN_MODEL || "deepseek-v4-flash-free").replace(/^deepseek-ai\//, ""));
  assert.equal(opencode?.capabilities.supportsReasoning, true);
  assert.equal(nvidia?.capabilities.supportsStreaming, true);
});

test("Provider Router — Environment Variable Switching", () => {
  const router = new LLMRouter();
  process.env.PRIMARY_PROVIDER = "opencode";
  let chain = router.resolveProviderChain();
  assert.equal(chain.primary.providerName, "opencode");
  assert.equal(chain.fallback.providerName, "nvidia");

  process.env.PRIMARY_PROVIDER = "nvidia";
  chain = router.resolveProviderChain();
  assert.equal(chain.primary.providerName, "nvidia");
  assert.equal(chain.fallback.providerName, "opencode");

  // Reset
  delete process.env.PRIMARY_PROVIDER;
});

test("Provider Router — Automatic Fallback on Primary Failure", async () => {
  const router = new LLMRouter();
  router.clearProviders();

  const failing = new MockFailingProvider();
  const success = new MockSuccessProvider();

  // Register mock providers exclusively
  router.registerProvider(failing);
  router.registerProvider(success);

  process.env.PRIMARY_PROVIDER = "mock_failing";

  const chain = router.resolveProviderChain();
  assert.equal(chain.primary.providerName, "mock_failing");
  assert.equal(chain.fallback.providerName, "mock_success");

  const messages: ModelMessage[] = [{ role: "user", content: "hey" }];
  const response = await router.generate(messages);

  assert.equal(response, "Hello from fallback provider!");

  const failingHealth = router.getHealthState("mock_failing");
  const successHealth = router.getHealthState("mock_success");

  assert.equal(failingHealth?.healthy, true, "1 failure doesn't permanently disable");
  assert.equal(failingHealth?.failureCount, 1);
  assert.equal(successHealth?.healthy, true);
  assert.equal(successHealth?.failureCount, 0);

  delete process.env.PRIMARY_PROVIDER;
});

test("Provider Router — Streaming Automatic Fallback", async () => {
  const router = new LLMRouter();
  router.clearProviders();
  router.registerProvider(new MockFailingProvider());
  router.registerProvider(new MockSuccessProvider());
  process.env.PRIMARY_PROVIDER = "mock_failing";

  const chunks: string[] = [];
  for await (const chunk of router.stream([{ role: "user", content: "hi" }])) {
    chunks.push(chunk);
  }

  assert.equal(chunks.join(""), "Hello from fallback stream!");
  delete process.env.PRIMARY_PROVIDER;
});

test("Provider Router — Diagnostics & Audit Logging", () => {
  const audit = formatMigrationAuditLog({
    provider: "opencode",
    model: "deepseek-ai/deepseek-v4-pro",
    promptChars: 40,
    promptTokens: 10,
    completionTokens: 5,
    finishReason: "stop",
    latencyMs: 120,
    chunks: 1,
    finalChars: 20,
    last100Chars: "hello world",
    isIncomplete: false,
    fallbackUsed: true,
    providerLatency: 120,
    providerSwitchReason: "504 Gateway Timeout",
  });

  assert.ok(audit.includes("Provider: opencode"));
  assert.ok(audit.includes("Model: deepseek-ai/deepseek-v4-pro"));
  assert.ok(audit.includes("Fallback Used: true"));
  assert.ok(audit.includes("Switch Reason: 504 Gateway Timeout"));
});
