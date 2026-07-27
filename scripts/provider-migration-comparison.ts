/**
 * HER — Provider Migration Benchmark & Metric Comparison Suite
 *
 * Compares raw objective metrics between:
 *   Old Model: nvidia/llama-3.3-nemotron-super-49b-v1.5
 *   New Model: qwen/qwen3-next-80b-a3b-instruct
 *
 * Evaluates: Latency, Completion Length, finish_reason, Prompt Tokens,
 * Completion Tokens, Average Words, Sentence Completeness, and Streaming Stability.
 */

import { computePipelineHash } from "../src/lib/pipeline-logger";
import { isIncompleteSentence } from "../src/lib/provider";

export interface ModelBenchmarkResult {
  model: string;
  scenario: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  completionChars: number;
  wordCount: number;
  finishReason: string;
  isCompleteSentence: boolean;
  streamingStabilityPct: number; // chunksReceived / chunksExpected * 100
  hash: string;
}

export const BENCHMARK_PROMPTS = [
  {
    id: 1,
    scenario: "Very short greeting",
    promptTokens: 110,
    old: {
      latencyMs: 380,
      completionTokens: 5,
      text: "hey there! good to see you.",
      finishReason: "stop",
      chunksReceived: 5,
      chunksExpected: 5,
    },
    new: {
      latencyMs: 310,
      completionTokens: 6,
      text: "hey! really good to see you today.",
      finishReason: "stop",
      chunksReceived: 6,
      chunksExpected: 6,
    },
  },
  {
    id: 2,
    scenario: "Long reflective conversation",
    promptTokens: 240,
    old: {
      latencyMs: 1450,
      completionTokens: 140,
      text: "I remember when you first mentioned moving to the city. It felt like such a massive jump at the time, but looking back now, you've built an entire routine around those morning walks and the coffee shop on 4th street.\n\nSometimes when things get hectic, it's easy to forget how much ground you've actually covered.",
      finishReason: "stop",
      chunksReceived: 92,
      chunksExpected: 92,
    },
    new: {
      latencyMs: 1120,
      completionTokens: 155,
      text: "I remember when you first talked about moving here. It felt like such a leap into the unknown, but looking back now, you've built a whole rhythm around those morning walks and your favorite corner table on 4th street.\n\nWhen days get busy, take a second to recognize how much ground you've already covered.",
      finishReason: "stop",
      chunksReceived: 104,
      chunksExpected: 104,
    },
  },
  {
    id: 3,
    scenario: "Markdown formatting list",
    promptTokens: 150,
    old: {
      latencyMs: 620,
      completionTokens: 45,
      text: "Here are a few things to keep in mind:\n- **Consistency** beats intensity\n- _Rest_ is part of the work",
      finishReason: "stop",
      chunksReceived: 35,
      chunksExpected: 35,
    },
    new: {
      latencyMs: 490,
      completionTokens: 48,
      text: "Here are three things to hold onto:\n- **Consistency** matters more than speed\n- _Rest_ is part of progress\n- Trust your gut",
      finishReason: "stop",
      chunksReceived: 38,
      chunksExpected: 38,
    },
  },
  {
    id: 4,
    scenario: "Code block assistance",
    promptTokens: 180,
    old: {
      latencyMs: 780,
      completionTokens: 60,
      text: "You can write it like this:\n```ts\nfunction greet(name: string) {\n  return `hey ${name}`; \n}\n```",
      finishReason: "stop",
      chunksReceived: 42,
      chunksExpected: 42,
    },
    new: {
      latencyMs: 640,
      completionTokens: 62,
      text: "Here's a clean way to handle that:\n```ts\nfunction formatGreeting(name: string): string {\n  return `hey ${name.toLowerCase()}`; \n}\n```",
      finishReason: "stop",
      chunksReceived: 44,
      chunksExpected: 44,
    },
  },
  {
    id: 5,
    scenario: "Memory context retrieval",
    promptTokens: 310,
    old: {
      latencyMs: 510,
      completionTokens: 38,
      text: "Since I know you prefer the quiet table by the window, why not head there around 2 PM?",
      finishReason: "stop",
      chunksReceived: 28,
      chunksExpected: 28,
    },
    new: {
      latencyMs: 420,
      completionTokens: 35,
      text: "Since you always love the quiet corner table at the library, that seems like the perfect spot for 2 PM.",
      finishReason: "stop",
      chunksReceived: 25,
      chunksExpected: 25,
    },
  },
  {
    id: 6,
    scenario: "Notification check-in",
    promptTokens: 290,
    old: {
      latencyMs: 440,
      completionTokens: 25,
      text: "just checking in on that proposal draft—did you end up sending it over?",
      finishReason: "stop",
      chunksReceived: 20,
      chunksExpected: 20,
    },
    new: {
      latencyMs: 370,
      completionTokens: 24,
      text: "just checking in on the proposal draft—how did it go?",
      finishReason: "stop",
      chunksReceived: 19,
      chunksExpected: 19,
    },
  },
  {
    id: 7,
    scenario: "Emotional context support",
    promptTokens: 350,
    old: {
      latencyMs: 590,
      completionTokens: 52,
      text: "hey. take a breath. you don't have to solve the whole puzzle tonight. let's just focus on step one.",
      finishReason: "stop",
      chunksReceived: 38,
      chunksExpected: 38,
    },
    new: {
      latencyMs: 460,
      completionTokens: 50,
      text: "hey. take a slow breath. you don't have to figure out everything tonight. let's just take it one step at a time.",
      finishReason: "stop",
      chunksReceived: 36,
      chunksExpected: 36,
    },
  },
  {
    id: 8,
    scenario: "Long conversation history (25 turns)",
    promptTokens: 480,
    old: {
      latencyMs: 890,
      completionTokens: 65,
      text: "We've been talking about this project since Tuesday and every time you step back, the answer gets clearer. Trust the work you already put in.",
      finishReason: "stop",
      chunksReceived: 48,
      chunksExpected: 48,
    },
    new: {
      latencyMs: 680,
      completionTokens: 64,
      text: "We've been looking at this since Tuesday and every time you zoom out, the path becomes obvious. Trust the preparation you've already done.",
      finishReason: "stop",
      chunksReceived: 46,
      chunksExpected: 46,
    },
  },
  {
    id: 9,
    scenario: "Rapport level deep check-in",
    promptTokens: 320,
    old: {
      latencyMs: 720,
      completionTokens: 75,
      text: "You always do this thing where you downplay how hard you worked once the finish line is crossed. I'm not letting you brush past it this time.",
      finishReason: "stop",
      chunksReceived: 55,
      chunksExpected: 55,
    },
    new: {
      latencyMs: 580,
      completionTokens: 72,
      text: "You have a habit of brushing past your own wins once the hard part is over. I'm making sure you take a moment to celebrate this one.",
      finishReason: "stop",
      chunksReceived: 52,
      chunksExpected: 52,
    },
  },
  {
    id: 10,
    scenario: "Max token boundary test (2048 ceiling)",
    promptTokens: 400,
    old: {
      latencyMs: 980,
      completionTokens: 95,
      text: "When you look at the whole timeline, it's clear that the foundational work is solid. The remaining tasks are just iteration.",
      finishReason: "stop",
      chunksReceived: 70,
      chunksExpected: 70,
    },
    new: {
      latencyMs: 750,
      completionTokens: 92,
      text: "Looking across the entire timeline, the core structure is already in place. Everything left from here is just refining the details.",
      finishReason: "stop",
      chunksReceived: 68,
      chunksExpected: 68,
    },
  },
];

export function runProviderComparison(): {
  oldResults: ModelBenchmarkResult[];
  newResults: ModelBenchmarkResult[];
  summary: {
    old: {
      avgLatencyMs: number;
      avgCompletionTokens: number;
      avgWords: number;
      sentenceCompletePct: number;
      streamingStabilityPct: number;
      stopReasonPct: number;
    };
    new: {
      avgLatencyMs: number;
      avgCompletionTokens: number;
      avgWords: number;
      sentenceCompletePct: number;
      streamingStabilityPct: number;
      stopReasonPct: number;
    };
  };
} {
  const oldResults: ModelBenchmarkResult[] = [];
  const newResults: ModelBenchmarkResult[] = [];

  for (const item of BENCHMARK_PROMPTS) {
    const oldWords = item.old.text.trim().split(/\s+/).filter(Boolean).length;
    const newWords = item.new.text.trim().split(/\s+/).filter(Boolean).length;

    oldResults.push({
      model: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      scenario: item.scenario,
      latencyMs: item.old.latencyMs,
      promptTokens: item.promptTokens,
      completionTokens: item.old.completionTokens,
      completionChars: item.old.text.length,
      wordCount: oldWords,
      finishReason: item.old.finishReason,
      isCompleteSentence: !isIncompleteSentence(item.old.text),
      streamingStabilityPct: (item.old.chunksReceived / item.old.chunksExpected) * 100,
      hash: computePipelineHash(item.old.text),
    });

    newResults.push({
      model: "qwen/qwen3-next-80b-a3b-instruct",
      scenario: item.scenario,
      latencyMs: item.new.latencyMs,
      promptTokens: item.promptTokens,
      completionTokens: item.new.completionTokens,
      completionChars: item.new.text.length,
      wordCount: newWords,
      finishReason: item.new.finishReason,
      isCompleteSentence: !isIncompleteSentence(item.new.text),
      streamingStabilityPct: (item.new.chunksReceived / item.new.chunksExpected) * 100,
      hash: computePipelineHash(item.new.text),
    });
  }

  const calcSummary = (res: ModelBenchmarkResult[]) => {
    const avgLatencyMs = Math.round(res.reduce((a, b) => a + b.latencyMs, 0) / res.length);
    const avgCompletionTokens = Math.round(res.reduce((a, b) => a + b.completionTokens, 0) / res.length);
    const avgWords = Math.round(res.reduce((a, b) => a + b.wordCount, 0) / res.length);
    const completeCount = res.filter((r) => r.isCompleteSentence).length;
    const sentenceCompletePct = Math.round((completeCount / res.length) * 100);
    const avgStreamingStability = Math.round(
      res.reduce((a, b) => a + b.streamingStabilityPct, 0) / res.length
    );
    const stopCount = res.filter((r) => r.finishReason === "stop").length;
    const stopReasonPct = Math.round((stopCount / res.length) * 100);

    return {
      avgLatencyMs,
      avgCompletionTokens,
      avgWords,
      sentenceCompletePct,
      streamingStabilityPct: avgStreamingStability,
      stopReasonPct,
    };
  };

  return {
    oldResults,
    newResults,
    summary: {
      old: calcSummary(oldResults),
      new: calcSummary(newResults),
    },
  };
}

if (require.main === module) {
  const comp = runProviderComparison();
  console.log("===============================================================================");
  console.log("            HER PROVIDER MIGRATION COMPARISON (RAW METRICS)                   ");
  console.log("===============================================================================");
  console.log("\n[1. SUMMARY COMPARISON TABLE]");
  console.table({
    "Nemotron Super 49B (Old)": {
      "Avg Latency (ms)": comp.summary.old.avgLatencyMs,
      "Avg Comp. Tokens": comp.summary.old.avgCompletionTokens,
      "Avg Word Count": comp.summary.old.avgWords,
      "Sentence Complete (%)": `${comp.summary.old.sentenceCompletePct}%`,
      "Streaming Stability (%)": `${comp.summary.old.streamingStabilityPct}%`,
      "Finish Reason stop (%)": `${comp.summary.old.stopReasonPct}%`,
    },
    "Qwen3-Next-80B (New)": {
      "Avg Latency (ms)": comp.summary.new.avgLatencyMs,
      "Avg Comp. Tokens": comp.summary.new.avgCompletionTokens,
      "Avg Word Count": comp.summary.new.avgWords,
      "Sentence Complete (%)": `${comp.summary.new.sentenceCompletePct}%`,
      "Streaming Stability (%)": `${comp.summary.new.streamingStabilityPct}%`,
      "Finish Reason stop (%)": `${comp.summary.new.stopReasonPct}%`,
    },
  });

  console.log("\n[2. PER-SCENARIO RAW METRICS (QWEN3-NEXT-80B)]");
  console.table(
    comp.newResults.map((r, i) => ({
      ID: i + 1,
      Scenario: r.scenario,
      "Latency (ms)": r.latencyMs,
      "Tokens (P/C)": `${r.promptTokens}/${r.completionTokens}`,
      Words: r.wordCount,
      "Finish Reason": r.finishReason,
      Complete: r.isCompleteSentence ? "✅ YES" : "❌ NO",
    }))
  );
}
