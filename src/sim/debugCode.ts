/**
 * sim/debugCode.ts — NEBULA: "DEBUG CODES" for sharing an exact city.
 *
 * A debug code is the full save (the same v10 JSON that serializeWorld()
 * writes: tiles, cells/zoning, road graph, buildings, parking lots,
 * utilities, seed, map size, terrain, cash, clock, tick …) squeezed into ONE
 * line of text that is safe to paste into chat:
 *
 *     LPC1:<base64url( deflate( utf8(saveJson) ) )>
 *
 *   - "LPC"  = Low-Poly City, "1" = the CODE format version (independent of
 *     the save version inside; the save carries its own `version`, and
 *     deserializeWorld() migrates old saves as usual).
 *   - deflate (raw, level 9) via fflate: synchronous, tiny, and works the
 *     same in the browser and in Node, so the CLI (tools/debug-load.ts) and
 *     the game share this exact file.
 *   - base64url (A–Z a–z 0–9 - _ , no padding) survives chat apps, URLs and
 *     line-wrapping (we strip ALL whitespace before decoding).
 *
 * Nothing here touches the DOM or localStorage: the UI (ui/menu.ts) does the
 * clipboard / storage parts.
 */
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

/** The prefix + code-format version every code starts with. */
export const DEBUG_CODE_PREFIX = 'LPC1:';

/** A decoded save that fails these checks is rejected before we touch the real save. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024; // 64 MB: far above a 192×192 city, guards zip bombs

/** Uint8Array -> base64url (no padding). Chunked so huge arrays don't blow the call stack. */
function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (padding optional) -> Uint8Array. Throws on characters outside the alphabet. */
function fromB64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('the code contains characters that are not part of a debug code');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Save JSON text (from serializeWorld / exportSaveText) -> "LPC1:…" code. */
export function encodeDebugCode(saveJson: string): string {
  return DEBUG_CODE_PREFIX + toB64url(deflateSync(strToU8(saveJson), { level: 9 }));
}

/** Result of decoding: either the save JSON text, or a human-readable reason it failed. */
export type DecodeResult = { ok: true; saveJson: string; save: Record<string, unknown> } | { ok: false; error: string };

/**
 * "LPC1:…" code -> save JSON text. NEVER throws: every failure (empty,
 * wrong prefix, truncated paste, corrupted data, not a save) comes back as
 * { ok: false, error } so the UI can just show the message.
 */
export function decodeDebugCode(input: string): DecodeResult {
  // Chat apps wrap long lines and add spaces/quotes/backticks — strip them.
  const code = (input ?? '').replace(/\s+/g, '').replace(/^[`'"]+|[`'"]+$/g, '');
  if (!code) return { ok: false, error: 'The debug code is empty.' };
  if (!code.startsWith(DEBUG_CODE_PREFIX)) {
    // A different LPC version is a clearer message than "wrong prefix".
    if (/^LPC\d+:/.test(code)) return { ok: false, error: `This debug code was made by a different game version (${code.split(':')[0]}); this game reads ${DEBUG_CODE_PREFIX.slice(0, -1)}.` };
    return { ok: false, error: `That is not a debug code (it should start with "${DEBUG_CODE_PREFIX}").` };
  }
  let json: string;
  try {
    const raw = inflateSync(fromB64url(code.slice(DEBUG_CODE_PREFIX.length)));
    if (raw.length > MAX_INFLATED_BYTES) return { ok: false, error: 'The debug code is too large.' };
    json = strFromU8(raw);
  } catch (e) {
    return { ok: false, error: `The debug code is damaged or incomplete (was all of it copied?): ${e instanceof Error ? e.message : e}` };
  }
  let save: Record<string, unknown>;
  try {
    save = JSON.parse(json);
  } catch {
    return { ok: false, error: 'The debug code decoded, but it does not contain a save.' };
  }
  // Same minimum shape importSaveText()/deserializeWorld() need.
  if (!save || typeof save !== 'object' || (!Array.isArray(save.tiles) && !save.tilesRle)) {
    return { ok: false, error: 'The debug code decoded, but it is not a city save.' };
  }
  return { ok: true, saveJson: json, save };
}
