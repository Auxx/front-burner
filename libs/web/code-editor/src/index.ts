export * from './code-editor/components/code-editor/code-editor.component';
export type { ConflictChoice, ConflictTexts } from './code-editor/conflicts/conflict-extension';
export {
  acceptConflict,
  conflictAtCursor,
  conflictsIn,
  goToConflict
} from './code-editor/conflicts/conflict-extension';
export type { ConflictPart, ConflictRegion } from './code-editor/conflicts/conflict-regions';
export { conflictRegions } from './code-editor/conflicts/conflict-regions';
export * from './code-editor/search/find-labels';
export * from './code-editor/state/editor-state';
