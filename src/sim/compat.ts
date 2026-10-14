/**
 * V1.5 update prompt: SIMULATION COMPATIBILITY NUMBER.
 *
 * Every deploy publishes `version.json` with this number (vite.config.ts
 * reads it from this file at build time). A running game compares the live
 * number with the one baked into its own bundle:
 *
 *   - same number  -> the new code can load the current save (possibly after
 *                     a normal SAVE_VERSION migration), so the game autosaves,
 *                     reloads and the player keeps going;
 *   - different    -> the new code can NOT continue this city, so the player
 *                     is asked to start a new one (and may export the save).
 *
 * RULE FOR DEVELOPERS: bump SIM_COMPAT only when an old save truly cannot be
 * migrated (e.g. map size change, removed systems with no migration). Normal
 * additions should bump SAVE_VERSION and write a migration instead.
 * Keep the literal on one line: the build reads it with a regex.
 */
export const SIM_COMPAT = 1;
