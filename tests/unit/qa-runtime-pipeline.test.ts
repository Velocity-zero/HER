import test from "node:test";
import assert from "node:assert/strict";
import { runQAPipelineTurn, runFullQASuite, QA_TEST_SCENARIOS } from "../../scripts/qa-pipeline-reproduction";

test("QA Runtime Engineering Suite — Verifies 20 Empirical Conversation Scenarios", () => {
  const results = runFullQASuite();
  assert.equal(results.length, 20);

  for (const r of results) {
    // Hashes must never diverge between Provider, Parser, Persistence, and Rendering
    assert.equal(r.hashDiverged, false, `Hash diverged in scenario ${r.id}: ${r.scenario}`);
    assert.equal(r.provider.hash, r.parser.hash);
    assert.equal(r.parser.hash, r.persistence.hash);
    assert.equal(r.persistence.hash, r.rendering.hash);
    assert.equal(r.rendering.length, r.rendering.displayed_length);
  }
});

test("QA Runtime Engineering Suite — Correctly Identifies Upstream Truncation Origins", () => {
  const scLengthTrunc = QA_TEST_SCENARIOS.find((s) => s.id === 11)!;
  const resLength = runQAPipelineTurn(scLengthTrunc);
  assert.equal(resLength.truncationOrigin, "Upstream (Provider finish_reason=length)");
  assert.equal(resLength.parser.chunks_received, 94);
  assert.equal(resLength.parser.chunks_expected, 94);

  const scStreamDrop = QA_TEST_SCENARIOS.find((s) => s.id === 12)!;
  const resDrop = runQAPipelineTurn(scStreamDrop);
  assert.equal(resDrop.truncationOrigin, "Upstream (Provider Stream Drop)");
  assert.equal(resDrop.parser.chunks_received, 45);
  assert.equal(resDrop.parser.chunks_expected, 90);
});
