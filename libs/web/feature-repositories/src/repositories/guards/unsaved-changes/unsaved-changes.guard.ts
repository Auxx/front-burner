import type { CanDeactivateFn } from '@angular/router';

/** A page that can ask the user before they leave it with unsaved changes. */
export interface LeavesWithCare {
  /** `true` to leave; asks the user first when needed. */
  canLeave(): boolean | Promise<boolean>;
}

/** Asks before leaving a page with changes, as AR-48 wants of the Add repository page. */
export const unsavedChangesGuard: CanDeactivateFn<LeavesWithCare> = component => component.canLeave();
