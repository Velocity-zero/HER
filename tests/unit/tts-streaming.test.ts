import { test } from "node:test";
import assert from "node:assert";
import { SentenceChunker } from "@/lib/sentence-chunker";
import { cleanTextForSpeech } from "@/app/api/tts/route";

test("SentenceChunker — splits streaming tokens across sentence boundaries", () => {
  const sentences: string[] = [];
  const chunker = new SentenceChunker((s) => sentences.push(s));

  // Feed stream in fragments
  chunker.push("Hello there. ");
  assert.deepStrictEqual(sentences, ["Hello there."]);

  chunker.push("How are ");
  chunker.push("you doing today? ");
  assert.deepStrictEqual(sentences, ["Hello there.", "How are you doing today?"]);

  chunker.push("I have been thinking about what you said earlier.");
  // Notice no trailing space yet, so still buffered or emitted
  chunker.flush();
  assert.deepStrictEqual(sentences, [
    "Hello there.",
    "How are you doing today?",
    "I have been thinking about what you said earlier.",
  ]);
});

test("SentenceChunker — does not break on abbreviations like Dr. or e.g.", () => {
  const sentences: string[] = [];
  const chunker = new SentenceChunker((s) => sentences.push(s));

  chunker.push("Dr. Smith said that e.g. exercise is very good for your mind. ");
  chunker.flush();

  assert.strictEqual(sentences.length, 1);
  assert.strictEqual(sentences[0], "Dr. Smith said that e.g. exercise is very good for your mind.");
});

test("SentenceChunker — does not break on decimals like 3.14", () => {
  const sentences: string[] = [];
  const chunker = new SentenceChunker((s) => sentences.push(s));

  chunker.push("The version is 3.14 and it works wonderfully. ");
  chunker.flush();

  assert.strictEqual(sentences.length, 1);
  assert.strictEqual(sentences[0], "The version is 3.14 and it works wonderfully.");
});

test("cleanTextForSpeech — cleans markdown, bold, emojis, URLs", () => {
  const input = "Hey **Samantha**! Look at [this page](https://her.ai) `code_sample` 😀... that is great!";
  const cleaned = cleanTextForSpeech(input);
  assert.strictEqual(cleaned, "Hey Samantha! Look at this page code_sample ... that is great!");
});

test("TTS Architecture — Decoupled TTSManager registers and delegates to active providers", async () => {
  const { TTSManager } = await import("@/lib/tts/tts-manager");
  const manager = TTSManager.getInstance();

  const providers = manager.getProviders();
  assert(providers.length >= 2, "Expected at least 2 default providers registered");

  const active = manager.getActiveProvider();
  assert.strictEqual(active.id, "edge-neural");

  // Custom mock provider
  let mockSynthesized = false;
  const mockProvider = {
    id: "mock-custom-model",
    name: "Custom Cloned Voice Model",
    type: "local" as const,
    isAvailable: () => true,
    synthesize: async () => {
      mockSynthesized = true;
      return new Uint8Array([1, 2, 3]).buffer;
    },
  };

  manager.registerProvider(mockProvider);
  assert.strictEqual(manager.setActiveProvider("mock-custom-model"), true);
  assert.strictEqual(manager.getActiveProvider().id, "mock-custom-model");

  const result = await manager.synthesize("test sentence", { voice: "custom" });
  assert.strictEqual(mockSynthesized, true);
  assert(result !== null);

  // Restore default
  manager.setActiveProvider("edge-neural");
});

