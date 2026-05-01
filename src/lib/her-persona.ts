/**
 * HER — Visual Identity & Persona Constants
 *
 * Central source of truth for HER's appearance description and reference image.
 * Used by the auto image pipeline to ensure character consistency across all
 * generated self-portrait images.
 *
 * Reference image: place the canonical HER reference image at
 *   public/her/reference.png
 * It is loaded server-side only (Node.js fs) — never imported by client code.
 */

import fs from "fs";
import path from "path";

/**
 * Textual description of HER's appearance.
 * Injected into every self-portrait prompt to anchor character consistency
 * alongside the reference image.
 */
export const HER_PERSONA_DESCRIPTION =
  "young woman, early 20s, dark brown shoulder-length hair, light green eyes, " +
  "natural minimal makeup, warm skin tone, soft facial features, genuine expression";

/**
 * Public path of the reference image (for client-side <img> src if ever needed).
 * The actual file is at public/her/reference.png.
 */
export const HER_REFERENCE_IMAGE_PUBLIC_PATH = "/her/reference.png";

/** Absolute filesystem path to the reference image */
const REFERENCE_IMAGE_FS_PATH = path.join(
  process.cwd(),
  "public",
  "her",
  "reference.png"
);

type ReferenceImage = { dataUrl: string; mimeType: string };

// Module-scope cache — the reference image is immutable for the life of the
// process, so we read & encode it at most once.
// `undefined` = not loaded yet, `null` = load attempted and failed/missing.
let cachedReference: ReferenceImage | null | undefined;

/**
 * Load HER's reference image from disk as a base64 data URL.
 * Server-side only. Returns null if the file is missing or unreadable.
 * Result is cached at module scope after the first call.
 */
export function loadHerReferenceImage(): ReferenceImage | null {
  if (cachedReference !== undefined) return cachedReference;

  try {
    if (!fs.existsSync(REFERENCE_IMAGE_FS_PATH)) {
      console.warn(
        "[HER Persona] Reference image not found at:",
        REFERENCE_IMAGE_FS_PATH
      );
      cachedReference = null;
      return null;
    }
    const buffer = fs.readFileSync(REFERENCE_IMAGE_FS_PATH);
    const base64 = buffer.toString("base64");
    const mimeType = "image/png";
    cachedReference = { dataUrl: `data:${mimeType};base64,${base64}`, mimeType };
    return cachedReference;
  } catch (err) {
    console.warn(
      "[HER Persona] Failed to load reference image:",
      err instanceof Error ? err.message : err
    );
    cachedReference = null;
    return null;
  }
}

/** Test-only: clear the cached reference image. */
export function _resetHerReferenceImageCache(): void {
  cachedReference = undefined;
}
