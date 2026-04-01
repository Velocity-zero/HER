/**
 * HER Image Studio — Runtime Smoke Test
 * 
 * Tests all API routes from Node.js without needing a browser.
 * Run with: node test-smoke.mjs
 */

const BASE = process.env.TEST_BASE || "http://localhost:3000";

async function test(label, url, body, expect) {
  process.stdout.write(`  ${label}... `);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const status = res.status;
    
    if (expect === "stream") {
      const text = await res.text();
      if (status === 200 && text.length > 5) {
        console.log(`✅ ${status} (${text.length} chars)`);
        return true;
      } else {
        console.log(`❌ ${status} body_len=${text.length}`);
        if (text.length < 500) console.log(`     Response: ${text.substring(0, 300)}`);
        return false;
      }
    }
    
    if (expect === "image") {
      const data = await res.json();
      if (status === 200 && data.image && data.image.startsWith("data:image")) {
        console.log(`✅ ${status} (image ${Math.round(data.image.length/1024)}KB)`);
        return true;
      } else {
        console.log(`❌ ${status} error=${data.error || "no image"}`);
        return false;
      }
    }
    
    if (expect === "error") {
      const data = await res.json();
      console.log(`✅ ${status} error="${data.error?.substring(0,80)}"`);
      return true;
    }
    
    console.log(`? ${status}`);
    return false;
  } catch (err) {
    console.log(`❌ NETWORK ERROR: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("\n=== HER SMOKE TEST ===\n");
  
  // ── A. Normal Chat ──
  console.log("A. Normal Chat:");
  await test(
    "Streaming chat",
    `${BASE}/api/chat?stream=true`,
    { messages: [{ id: "t1", role: "user", content: "Say hi in one sentence", timestamp: Date.now() }] },
    "stream"
  );
  
  // ── B. Quick Image (legacy simple path) ──
  console.log("\nB. Quick Image (legacy SD3 default):");
  await test(
    "Simple prompt → SD3 Medium",
    `${BASE}/api/imagine`,
    { prompt: "A glowing neon cat in a cyberpunk alley" },
    "image"
  );
  
  // ── C. Image Studio — Create Mode ──
  console.log("\nC. Image Studio — Create Mode:");
  
  await test(
    "SD3 Medium (explicit)",
    `${BASE}/api/imagine`,
    { prompt: "A serene mountain lake at dawn", modelId: "stable-diffusion-3-medium", mode: "create" },
    "image"
  );
  
  await test(
    "Flux.2 Klein 4B",
    `${BASE}/api/imagine`,
    { prompt: "A futuristic space station orbiting Earth", modelId: "flux-2-klein-4b", mode: "create" },
    "image"
  );
  
  await test(
    "Flux.1 Dev",
    `${BASE}/api/imagine`,
    { prompt: "An oil painting of a sunset over the ocean", modelId: "flux-1-dev", mode: "create" },
    "image"
  );
  
  // ── D. Image Studio — Edit Mode (no real image, test validation) ──
  console.log("\nD. Image Studio — Edit Mode:");
  
  await test(
    "Edit mode missing image → validation error",
    `${BASE}/api/imagine`,
    { prompt: "Make it rainy", modelId: "flux-1-kontext-dev", mode: "edit" },
    "error"
  );
  
  // ── E. Validation Tests ──
  console.log("\nE. Validation:");
  
  await test(
    "Empty prompt rejected",
    `${BASE}/api/imagine`,
    { prompt: "" },
    "error"
  );
  
  await test(
    "Invalid model rejected",
    `${BASE}/api/imagine`,
    { prompt: "test", modelId: "nonexistent-model", mode: "create" },
    "error"
  );
  
  await test(
    "Mode mismatch rejected",
    `${BASE}/api/imagine`,
    { prompt: "test", modelId: "stable-diffusion-3-medium", mode: "edit" },
    "error"
  );
  
  console.log("\n=== SMOKE TEST COMPLETE ===\n");
}

main().catch(console.error);
