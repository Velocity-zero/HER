/**
 * DEV-ONLY: Image Stress Test Harness Endpoint
 *
 * POST /api/imagine/test
 *
 * Runs a bounded matrix of image generation and edit tests against all
 * configured NVIDIA image models. Returns a structured JSON report.
 *
 * Completely blocked in production (returns 404).
 *
 * Query params (all optional):
 *   maxTests   — hard cap on total test cases (default: 60)
 *   delayMs    — ms between requests (default: 1500)
 *   maxFails   — repeated failures per model before skipping (default: 2)
 *   dryRun     — if "true", returns the test matrix without executing
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildTestMatrix,
  runTestHarness,
  type HarnessOptions,
  type TestMode,
} from "@/lib/image-test-harness";

// ── Production Gate ────────────────────────────────────────

function isDevEnvironment(): boolean {
  return process.env.NODE_ENV !== "production";
}

// ── POST /api/imagine/test ─────────────────────────────────

export async function POST(req: NextRequest) {
  // Hard block in production
  if (!isDevEnvironment()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const url = new URL(req.url);

    // Parse optional query params
    const maxTests = parseInt(url.searchParams.get("maxTests") ?? "60", 10);
    const delayMs = parseInt(url.searchParams.get("delayMs") ?? "1500", 10);
    const maxFails = parseInt(url.searchParams.get("maxFails") ?? "2", 10);
    const dryRun = url.searchParams.get("dryRun") === "true";
    const filterMode = url.searchParams.get("mode") as TestMode | null;
    const filterModel = url.searchParams.get("model");

    // ── Dry run: return the matrix without executing ──
    if (dryRun) {
      const matrix = buildTestMatrix({
        filterMode: filterMode || undefined,
        filterModel: filterModel || undefined,
      });
      return NextResponse.json({
        dryRun: true,
        totalCases: matrix.length,
        cases: matrix,
        generateModels: [...new Set(matrix.filter((c) => c.mode === "generate").map((c) => c.model))],
        editModels: [...new Set(matrix.filter((c) => c.mode === "edit").map((c) => c.model))],
        filters: {
          mode: filterMode || "all",
          model: filterModel || "all",
        },
      });
    }

    // ── Derive base URL from the incoming request ──
    const origin = url.origin; // e.g. "http://localhost:3000"

    const options: HarnessOptions = {
      maxTests: Math.max(1, Math.min(maxTests, 120)), // hard ceiling 120
      delayMs: Math.max(500, Math.min(delayMs, 10000)),
      maxRepeatedFailures: Math.max(1, Math.min(maxFails, 10)),
      baseUrl: origin,
      filterMode: filterMode || undefined,
      filterModel: filterModel || undefined,
    };

    console.log(
      `[HER Test Harness] Starting stress test — ` +
      `maxTests=${options.maxTests} delayMs=${options.delayMs} maxFails=${options.maxRepeatedFailures}` +
      (filterMode ? ` mode=${filterMode}` : "") +
      (filterModel ? ` model=${filterModel}` : "")
    );

    const summary = await runTestHarness(origin, options);

    console.log(
      `[HER Test Harness] Complete — ` +
      `${summary.passed}/${summary.totalTests} passed, ` +
      `${summary.failed} failed, ${summary.skipped} skipped ` +
      `(${(summary.durationMs / 1000).toFixed(1)}s)`
    );

    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[HER Test Harness] Unhandled error:", msg);
    return NextResponse.json(
      { error: `Test harness failed: ${msg}` },
      { status: 500 }
    );
  }
}

// ── GET /api/imagine/test — Quick info / health check ──────

export async function GET() {
  if (!isDevEnvironment()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const matrix = buildTestMatrix();
  const generateModels = [...new Set(matrix.filter((c) => c.mode === "generate").map((c) => c.model))];
  const editModels = [...new Set(matrix.filter((c) => c.mode === "edit").map((c) => c.model))];

  return NextResponse.json({
    status: "ready",
    environment: process.env.NODE_ENV,
    totalCases: matrix.length,
    generateModels,
    editModels,
    usage: {
      run: "POST /api/imagine/test",
      dryRun: "POST /api/imagine/test?dryRun=true",
      options: "?maxTests=N&delayMs=N&maxFails=N",
      filters: "?mode=generate|edit&model=<model-id>",
      editOnly: "POST /api/imagine/test?mode=edit",
      singleModel: "POST /api/imagine/test?model=flux-1-kontext-dev",
    },
  });
}
