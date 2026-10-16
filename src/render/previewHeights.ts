/**
 * NEBULA zoning-angle fix: heights (in tile units) of the placement highlights.
 *
 * The pointer is picked where the camera ray meets the flat y=0 ground plane
 * (ui/input.ts). A highlight drawn at height h is seen displaced on screen by
 * about h / tan(pitch) tiles along the view direction, so a lifted highlight
 * lines up from straight above but slides off the squares that will actually be
 * zoned when the camera is low. Both highlights therefore sit on the pick plane
 * (just a hair above, to stay clear of the ground mesh) and are drawn with
 * depthTest off so roads, kerbs and lot pads cannot hide them.
 * tools/zoneangles.test.ts checks this at every yaw, pitch and zoom.
 */
/** Graph block cell highlight (GraphRoadLayer.showPreview). Was Y_ZONE + 0.004 = 0.068. */
export const Y_PREVIEW = 0.002;
/** Tile highlight (cityRenderer PreviewRenderer). Was 0.12 (fill) / 0.13 (edges). */
export const TILE_PREVIEW_Y = 0.002;
