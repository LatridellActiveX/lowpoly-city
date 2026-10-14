/**
 * V1.5 save slots. The game still autosaves to the single main save key
 * (save.ts); slots are named copies of that JSON plus a little metadata for
 * the title screen's Load list. Loading a slot copies it back into the main
 * key, then the normal loadWorld() (with all its migrations) reads it.
 */
import { exportSaveText, importSaveText } from './save';

export const SLOT_COUNT = 3;
const slotKey = (i: number) => `lowpoly-city-slot-${i}`;

export interface SlotMeta {
  pop: number;
  savedAt: number;
}

/** Metadata for every slot (null = empty). Population is read from the save's tiles. */
export function listSlots(): Array<SlotMeta | null> {
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    try {
      const raw = localStorage.getItem(slotKey(i));
      if (!raw) return null;
      const d = JSON.parse(raw);
      return { pop: d.meta?.pop ?? 0, savedAt: d.meta?.savedAt ?? 0 };
    } catch {
      return null;
    }
  });
}

/** Copy the current main save into slot `i`. Returns false if there's no save. */
export function saveToSlot(i: number): boolean {
  const text = exportSaveText();
  if (!text) return false;
  // Peak population is stored in every v6+ save; good enough for a label.
  let pop = 0;
  try { pop = JSON.parse(text).peakPop ?? 0; } catch { /* keep 0 */ }
  localStorage.setItem(slotKey(i), JSON.stringify({ meta: { pop, savedAt: Date.now() }, save: text }));
  return true;
}

/** Make slot `i` the main save (then call loadWorld()). */
export function loadSlotIntoMain(i: number): boolean {
  const raw = localStorage.getItem(slotKey(i));
  if (!raw) return false;
  try {
    return importSaveText(JSON.parse(raw).save);
  } catch {
    return false;
  }
}
