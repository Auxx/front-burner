import { Injectable } from '@angular/core';

const KEY = 'front-burner.dashboard.has-repositories.';

/**
 * Whether the user had repositories the last time the dashboard loaded in this
 * browser, so that the right form of the guide shows before the list loads
 * (DS-25). Storage that is missing or refuses access reads as "no".
 */
@Injectable({ providedIn: 'root' })
export class DashboardHintService {
  hadRepositories(userId: number): boolean {
    try {
      return localStorage.getItem(KEY + userId) !== null;
    } catch {
      return false;
    }
  }

  remember(userId: number, has: boolean): void {
    try {
      if (has) {
        localStorage.setItem(KEY + userId, '1');
      } else {
        localStorage.removeItem(KEY + userId);
      }
    } catch {
      // Only a hint: without storage the full guide shows until the list loads.
    }
  }
}
