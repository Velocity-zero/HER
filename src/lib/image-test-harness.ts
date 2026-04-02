/**
 * HER — Internal Image Stress-Test Harness
 *
 * DEV-ONLY utility for systematically verifying every configured image model
 * against bounded parameter combinations.
 *
 * This module is never imported by production code paths.
 * It is only invoked via the dev-only /api/imagine/test route.
 *
 * Key design constraints:
 *   - Uses the real IMAGE_MODELS registry (no separate hardcoded list)
 *   - Curated matrix, not brute-force permutation explosion
 *   - Sequential execution with inter-request delay
 *   - Early-exit on repeated identical structural errors
 *   - Never stores full base64 blobs in results
 */

import {
  IMAGE_MODELS,
  type ImageModelDef,
  type AspectRatio,
  resolveApiKey,
} from "@/lib/image-models";

// ── Types ──────────────────────────────────────────────────

export type TestMode = "generate" | "edit";
export type SeedMode = "none" | "fixed";

export interface TestCase {
  id: number;
  mode: TestMode;
  model: string;
  promptLabel: string;
  aspectRatio: string;
  steps: number;
  seedMode: SeedMode;
  cfgScale: number | null;
  /** For edit mode — prompt text */
  prompt: string;
  /** For edit mode — true when source image is attached */
  hasSourceImage: boolean;
}

export interface TestResult {
  mode: TestMode;
  model: string;
  promptLabel: string;
  aspectRatio: string;
  steps: number;
  seedMode: SeedMode;
  cfgScale: number | null;
  status: "success" | "fail" | "skipped";
  httpStatus: number | null;
  durationMs: number;
  responseShapeMatched: string | null;
  base64Length: number | null;
  error: string | null;
}

export interface TestSummary {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  perModel: Record<string, { passed: number; failed: number; skipped: number }>;
  perMode: Record<string, { passed: number; failed: number; skipped: number }>;
  failures: TestResult[];
  failureBuckets: Record<string, number>;
  unsupportedCombos: string[];
  durationMs: number;
}

export interface HarnessOptions {
  /** Maximum total test cases to run (hard cap). Default: 60 */
  maxTests?: number;
  /** Delay between requests in ms. Default: 1500 */
  delayMs?: number;
  /** Max identical structural failures per model before skipping. Default: 2 */
  maxRepeatedFailures?: number;
  /** Base URL of the running app (for internal fetch). Default: derived from request */
  baseUrl?: string;
  /** Skip prompt enhancement to speed up tests. Default: false */
  skipEnhancement?: boolean;
  /** Filter: only run tests for this mode ("generate" or "edit"). Default: all */
  filterMode?: TestMode;
  /** Filter: only run tests for this specific model ID. Default: all */
  filterModel?: string;
}

// ── Constants ──────────────────────────────────────────────

const FIXED_SEED = 12345;

const GENERATE_PROMPTS: { label: string; text: string }[] = [
  { label: "cinematic-portrait", text: "a cinematic portrait of a woman in soft neon light" },
  { label: "futuristic-city",    text: "a futuristic city at dusk, ultra detailed" },
  { label: "cozy-room",          text: "a cozy reading room with warm golden lighting" },
];

const EDIT_PROMPTS: { label: string; text: string }[] = [
  { label: "warm-lighting", text: "make the lighting warmer" },
  { label: "watercolor",    text: "turn this into a dreamy watercolor illustration" },
];

const TEST_ASPECT_RATIOS: AspectRatio[] = ["1:1", "16:9", "9:16"];

/**
 * Step tiers per model — clamped to each model's actual range.
 * We pick low/medium/high values that are safe across providers.
 */
const STEP_TIERS = {
  low:    20,
  medium: 30,
  high:   40,
};

/**
 * 256×256 warm gradient JPEG (~2.3 KB) encoded as base64.
 * Generated via sharp with a sinusoidal color gradient in HER's warm palette.
 * Large enough to satisfy NVIDIA provider image validation requirements,
 * small enough to inline without bloating the module.
 * Used as the source image fixture for edit mode tests.
 */
const TEST_SOURCE_IMAGE_B64 =
  "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" +
  "6m3prJEiJIpdaU4f/9k=";

// ── Matrix Builder ─────────────────────────────────────────

/**
 * Build a curated (not brute-force) test matrix.
 *
 * Supports optional filters:
 *   filterMode  — "generate" or "edit" to test only one mode
 *   filterModel — specific model ID to test only that model
 *
 * Strategy:
 *   For each generation model:
 *     prompt[0] × all 3 aspect ratios × medium steps × no seed    (3 tests)
 *     prompt[1] × 1:1 × all 3 step tiers × no seed                (3 tests)
 *     prompt[2] × 1:1 × medium steps × fixed seed                 (1 test)
 *     if cfg_scale → prompt[0] × 1:1 × medium × no seed           (1 test, already covered — skip dupe)
 *   Per create model: ~7 tests
 *
 *   For each edit model:
 *     edit-prompt[0] × match_input × low/medium/high steps × no seed   (3 tests)
 *     edit-prompt[1] × 1:1 × medium steps × fixed seed                 (1 test)
 *   Per edit model: ~4 tests
 *
 *   Total with 3 create + 1 edit (unfiltered): ~25 tests — well within bounds.
 */
export function buildTestMatrix(options?: {
  filterMode?: TestMode;
  filterModel?: string;
}): TestCase[] {
  const cases: TestCase[] = [];
  let id = 0;

  const wantGenerate = !options?.filterMode || options.filterMode === "generate";
  const wantEdit = !options?.filterMode || options.filterMode === "edit";
  const filterModel = options?.filterModel;

  const createModels = IMAGE_MODELS.filter((m) =>
    m.mode === "create" && (!filterModel || m.id === filterModel)
  );
  const editModels = IMAGE_MODELS.filter((m) =>
    m.mode === "edit" && (!filterModel || m.id === filterModel)
  );

  // ── Generate matrix ──
  if (wantGenerate) {
  for (const model of createModels) {
    const hasCfg = model.capabilities.cfg_scale;
    const defaultCfg = hasCfg ? (model.defaults.cfg_scale as number) : null;
    const medSteps = clampSteps(STEP_TIERS.medium, model);

    // Prompt 0 × 3 aspect ratios × medium steps × no seed
    for (const ar of TEST_ASPECT_RATIOS) {
      cases.push({
        id: ++id,
        mode: "generate",
        model: model.id,
        promptLabel: GENERATE_PROMPTS[0].label,
        prompt: GENERATE_PROMPTS[0].text,
        aspectRatio: ar,
        steps: medSteps,
        seedMode: "none",
        cfgScale: defaultCfg,
        hasSourceImage: false,
      });
    }

    // Prompt 1 × 1:1 × 3 step tiers × no seed
    for (const tier of Object.values(STEP_TIERS)) {
      const steps = clampSteps(tier, model);
      cases.push({
        id: ++id,
        mode: "generate",
        model: model.id,
        promptLabel: GENERATE_PROMPTS[1].label,
        prompt: GENERATE_PROMPTS[1].text,
        aspectRatio: "1:1",
        steps,
        seedMode: "none",
        cfgScale: defaultCfg,
        hasSourceImage: false,
      });
    }

    // Prompt 2 × 1:1 × medium steps × fixed seed
    cases.push({
      id: ++id,
      mode: "generate",
      model: model.id,
      promptLabel: GENERATE_PROMPTS[2].label,
      prompt: GENERATE_PROMPTS[2].text,
      aspectRatio: "1:1",
      steps: medSteps,
      seedMode: "fixed",
      cfgScale: defaultCfg,
      hasSourceImage: false,
    });
  }
  } // end if (wantGenerate)

  // ── Edit matrix ──
  if (wantEdit) {
  for (const model of editModels) {
    const hasCfg = model.capabilities.cfg_scale;
    const defaultCfg = hasCfg ? (model.defaults.cfg_scale as number) : null;

    // Edit prompt 0 × match_input_image × 3 step tiers × no seed
    for (const tier of Object.values(STEP_TIERS)) {
      const steps = clampSteps(tier, model);
      cases.push({
        id: ++id,
        mode: "edit",
        model: model.id,
        promptLabel: EDIT_PROMPTS[0].label,
        prompt: EDIT_PROMPTS[0].text,
        aspectRatio: "match_input_image",
        steps,
        seedMode: "none",
        cfgScale: defaultCfg,
        hasSourceImage: true,
      });
    }

    // Edit prompt 1 × 1:1 × medium steps × fixed seed
    cases.push({
      id: ++id,
      mode: "edit",
      model: model.id,
      promptLabel: EDIT_PROMPTS[1].label,
      prompt: EDIT_PROMPTS[1].text,
      aspectRatio: "1:1",
      steps: clampSteps(STEP_TIERS.medium, model),
      seedMode: "fixed",
      cfgScale: defaultCfg,
      hasSourceImage: true,
    });
  }
  } // end if (wantEdit)

  return cases;
}

/** Clamp a desired step count to the model's actual safe range. */
function clampSteps(desired: number, model: ImageModelDef): number {
  const range = model.ranges.steps;
  if (!range) return desired;
  return Math.max(range.min, Math.min(range.max, desired));
}

// ── Runner ─────────────────────────────────────────────────

/**
 * Execute the full test matrix sequentially with safety controls.
 *
 * @param baseUrl  The base URL of the running Next.js app (e.g. "http://localhost:3000")
 * @param options  Harness configuration
 * @returns        Promise resolving to the full summary report
 */
export async function runTestHarness(
  baseUrl: string,
  options: HarnessOptions = {}
): Promise<TestSummary> {
  const maxTests = options.maxTests ?? 60;
  const delayMs = options.delayMs ?? 1500;
  const maxRepeated = options.maxRepeatedFailures ?? 2;

  const matrix = buildTestMatrix({
    filterMode: options.filterMode,
    filterModel: options.filterModel,
  });
  const capped = matrix.slice(0, maxTests);

  const results: TestResult[] = [];
  const unsupportedCombos: string[] = [];

  // Track repeated structural failures per model
  const modelFailureCounts: Record<string, Record<string, number>> = {};
  // Track skipped models (hit max repeated failures)
  const skippedModels = new Set<string>();

  const harnessStart = Date.now();

  for (let i = 0; i < capped.length; i++) {
    const tc = capped[i];

    // ── Skip if model already failed repeatedly with same error ──
    if (skippedModels.has(tc.model)) {
      results.push({
        mode: tc.mode,
        model: tc.model,
        promptLabel: tc.promptLabel,
        aspectRatio: tc.aspectRatio,
        steps: tc.steps,
        seedMode: tc.seedMode,
        cfgScale: tc.cfgScale,
        status: "skipped",
        httpStatus: null,
        durationMs: 0,
        responseShapeMatched: null,
        base64Length: null,
        error: `Skipped: model hit ${maxRepeated} repeated structural failures`,
      });
      continue;
    }

    // ── Validate API key exists before wasting a call ──
    const modelDef = IMAGE_MODELS.find((m) => m.id === tc.model);
    if (!modelDef) {
      results.push(makeSkippedResult(tc, "Model not found in registry"));
      continue;
    }
    const apiKey = resolveApiKey(modelDef);
    if (!apiKey) {
      results.push(makeSkippedResult(tc, `No API key: ${modelDef.envKey}`));
      unsupportedCombos.push(`${tc.model}: missing API key (${modelDef.envKey})`);
      skippedModels.add(tc.model); // no point retrying
      continue;
    }

    // ── Build request payload ──
    const requestBody: Record<string, unknown> = {
      prompt: tc.prompt,
      modelId: tc.model,
      mode: tc.mode === "generate" ? "create" : "edit",
      aspect_ratio: tc.aspectRatio,
      steps: tc.steps,
    };

    if (tc.seedMode === "fixed") {
      requestBody.seed = FIXED_SEED;
    }

    if (tc.cfgScale !== null) {
      requestBody.cfg_scale = tc.cfgScale;
    }

    if (tc.hasSourceImage) {
      requestBody.image = `data:image/jpeg;base64,${TEST_SOURCE_IMAGE_B64}`;
    }

    // ── Execute ──
    const start = Date.now();
    let result: TestResult;

    try {
      const res = await fetch(`${baseUrl}/api/imagine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const elapsed = Date.now() - start;
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;

      if (res.ok && typeof body.image === "string") {
        // Success — extract metadata without storing the full blob
        const imageStr = body.image as string;
        // Strip data URL prefix to get raw base64 length
        const b64Start = imageStr.indexOf(",");
        const rawB64 = b64Start > 0 ? imageStr.slice(b64Start + 1) : imageStr;

        result = {
          mode: tc.mode,
          model: tc.model,
          promptLabel: tc.promptLabel,
          aspectRatio: tc.aspectRatio,
          steps: tc.steps,
          seedMode: tc.seedMode,
          cfgScale: tc.cfgScale,
          status: "success",
          httpStatus: res.status,
          durationMs: elapsed,
          responseShapeMatched: "data-url", // image came back as data URL
          base64Length: rawB64.length,
          error: null,
        };
      } else {
        // Failure
        const errMsg = (typeof body.error === "string" ? body.error : `HTTP ${res.status}`)
          .slice(0, 200);

        result = {
          mode: tc.mode,
          model: tc.model,
          promptLabel: tc.promptLabel,
          aspectRatio: tc.aspectRatio,
          steps: tc.steps,
          seedMode: tc.seedMode,
          cfgScale: tc.cfgScale,
          status: "fail",
          httpStatus: res.status,
          durationMs: elapsed,
          responseShapeMatched: null,
          base64Length: null,
          error: errMsg,
        };

        // Track repeated structural failures
        trackFailure(modelFailureCounts, tc.model, errMsg, maxRepeated, skippedModels);

        // If rate limited, skip remaining tests for this model
        if (res.status === 429) {
          skippedModels.add(tc.model);
          unsupportedCombos.push(`${tc.model}: rate limited (429)`);
        }
      }
    } catch (err) {
      const elapsed = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : "Unknown fetch error";

      result = {
        mode: tc.mode,
        model: tc.model,
        promptLabel: tc.promptLabel,
        aspectRatio: tc.aspectRatio,
        steps: tc.steps,
        seedMode: tc.seedMode,
        cfgScale: tc.cfgScale,
        status: "fail",
        httpStatus: null,
        durationMs: elapsed,
        responseShapeMatched: null,
        base64Length: null,
        error: errMsg.slice(0, 200),
      };

      trackFailure(modelFailureCounts, tc.model, errMsg, maxRepeated, skippedModels);
    }

    results.push(result);

    // ── Inter-request delay (skip after last test) ──
    if (i < capped.length - 1) {
      await sleep(delayMs);
    }
  }

  const harnessEnd = Date.now();

  return buildSummary(results, unsupportedCombos, harnessEnd - harnessStart);
}

// ── Summary Builder ────────────────────────────────────────

function buildSummary(
  results: TestResult[],
  unsupportedCombos: string[],
  totalDurationMs: number
): TestSummary {
  const passed = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  // Per-model counts
  const perModel: Record<string, { passed: number; failed: number; skipped: number }> = {};
  for (const r of results) {
    if (!perModel[r.model]) perModel[r.model] = { passed: 0, failed: 0, skipped: 0 };
    perModel[r.model][r.status === "success" ? "passed" : r.status === "fail" ? "failed" : "skipped"]++;
  }

  // Per-mode counts
  const perMode: Record<string, { passed: number; failed: number; skipped: number }> = {};
  for (const r of results) {
    if (!perMode[r.mode]) perMode[r.mode] = { passed: 0, failed: 0, skipped: 0 };
    perMode[r.mode][r.status === "success" ? "passed" : r.status === "fail" ? "failed" : "skipped"]++;
  }

  // Failure buckets (group by HTTP status or error pattern)
  const failureBuckets: Record<string, number> = {};
  const failures = results.filter((r) => r.status === "fail");
  for (const f of failures) {
    const bucket = f.httpStatus ? `HTTP ${f.httpStatus}` : "network/fetch";
    failureBuckets[bucket] = (failureBuckets[bucket] || 0) + 1;
  }

  return {
    totalTests: results.length,
    passed,
    failed,
    skipped,
    perModel,
    perMode,
    failures,
    failureBuckets,
    unsupportedCombos,
    durationMs: totalDurationMs,
  };
}

// ── Internal Helpers ───────────────────────────────────────

function makeSkippedResult(tc: TestCase, reason: string): TestResult {
  return {
    mode: tc.mode,
    model: tc.model,
    promptLabel: tc.promptLabel,
    aspectRatio: tc.aspectRatio,
    steps: tc.steps,
    seedMode: tc.seedMode,
    cfgScale: tc.cfgScale,
    status: "skipped",
    httpStatus: null,
    durationMs: 0,
    responseShapeMatched: null,
    base64Length: null,
    error: reason,
  };
}

/**
 * Track how many times a model has failed with a similar error.
 * If the threshold is reached, add it to the skipped set.
 */
function trackFailure(
  counts: Record<string, Record<string, number>>,
  modelId: string,
  errorMsg: string,
  maxRepeated: number,
  skippedSet: Set<string>
): void {
  if (!counts[modelId]) counts[modelId] = {};

  // Normalize error for bucketing — take first 60 chars
  const key = errorMsg.slice(0, 60).toLowerCase().trim();
  counts[modelId][key] = (counts[modelId][key] || 0) + 1;

  if (counts[modelId][key] >= maxRepeated) {
    skippedSet.add(modelId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
