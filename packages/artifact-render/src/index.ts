/* SPDX-License-Identifier: MIT */

export { buildSrcdoc, type SrcdocOptions } from "./srcdoc.js"
export { STORAGE_SHIM_SCRIPT } from "./bridges/storage-shim.js"
export { FOCUS_GUARD_SCRIPT } from "./bridges/focus-guard.js"
export {
  htmlNeedsFocusGuard,
  htmlNeedsStorageShim,
  shouldUrlLoad,
  type RenderDecision,
} from "./render-mode.js"
export {
  createArtifactParser,
  type ArtifactEvent,
} from "./stream-parser.js"
export { resolveRenderer } from "./renderer-registry.js"
export {
  DEFAULT_VIEWPORT,
  DEFAULT_ZOOM,
  VIEWPORT_IDS,
  VIEWPORT_PRESETS,
  ZOOM_PRESETS,
  effectiveScale,
  findViewport,
  fitScale,
  type ViewportId,
  type ViewportPreset,
} from "./viewport.js"
export {
  INLINEABLE_PROPERTIES,
  SNAPSHOT_BRIDGE_SCRIPT,
  SNAPSHOT_ERROR_CODES,
  SNAPSHOT_TIMEOUT_MS,
  looksBlank,
  type Rgba,
  type SnapshotError,
  type SnapshotErrorCode,
  type SnapshotMessage,
  type SnapshotRequest,
  type SnapshotResult,
} from "./bridges/snapshot.js"
export {
  ANCESTOR_FOR_DIV,
  EXCLUDED_TAGS,
  STRUCTURAL_TAGS,
  annotateSelectableElements,
  computePathId,
} from "./annotate.js"
export {
  SELECTION_BRIDGE_SCRIPT,
  type SelectionMessage,
  type SelectModeRequest,
  type SelectTargetMessage,
} from "./bridges/selection.js"
export {
  EDIT_BRIDGE_SCRIPT,
  type EditMessage,
  type EditModeRequest,
  type EditResultMessage,
} from "./bridges/edit.js"
export {
  INSPECTABLE_PROPERTIES,
  INSPECT_STYLESHEET_ID,
  filterInspectionOverrides,
  inspectionEquals,
  isInspectableProperty,
  renderInspectionStylesheet,
  type InspectOverride,
  type InspectableProperty,
} from "./bridges/inspect.js"
export {
  PALETTE_NODE_BUDGET,
  PALETTE_RULE_BUDGET,
  applyPalette,
  hslToHex,
  parseRgb,
  readPaletteFromRoot,
  revertPalette,
  rgbToHsl,
  shiftHue,
  snapshotPalette,
  type CssVariable,
  type PaletteSnapshot,
} from "./bridges/palette.js"
export {
  TWEAKS_BRIDGE_SCRIPT,
  TWEAKS_PANEL_ATTRIBUTE,
  TWEAKS_TOGGLE_MESSAGE_TYPE,
  findTweaksPanel,
  toggleTweaksPanel,
  type TweaksPanel,
} from "./bridges/tweaks.js"
export {
  formatUnifiaPath,
  parseUnifiaPath,
  pathOfUnifiaNode,
  resolveUnifiaPath,
  type PathIndex,
  type TreeNode,
} from "./bridges/manual-edit.js"
