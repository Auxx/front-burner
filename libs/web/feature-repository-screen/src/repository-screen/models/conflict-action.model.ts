import type { GitResolution } from '@front-burner/shared-contracts';

/** What is done to one conflicting file: a resolution, or **Start over** (GC-14 to GC-18). */
export type ConflictAction = GitResolution | 'start-over';
