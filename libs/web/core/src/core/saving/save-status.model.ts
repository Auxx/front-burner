/**
 * The save status of a file (ED-18): saved, a save waiting or in flight,
 * saves failing to reach the backend and retried, or a save the backend
 * refused with its error code (ED-19).
 */
export type SaveStatus =
  | { kind: 'saved'; }
  | { kind: 'saving'; }
  | { kind: 'offline'; }
  | { kind: 'refused'; code: string; };

/** What the backend answers to a save: the content hash of the file on disk (ED-6). */
export interface SaveResult {
  hash: string;
}
