import { Injectable } from '@angular/core';

const KEY = 'front-burner.dashboard.has-repositories';

interface Hint {
  userId: number;
  has: boolean;
}

/**
 * Whether the user had repositories the last time the dashboard loaded in this
 * browser, so that the right form of the guide shows before the list loads
 * (DS-25). After a login or a reload the dashboard renders before the user is
 * loaded, so the hint also answers for the last user of this browser. Storage
 * that is missing or refuses access reads as "no".
 */
@Injectable({ providedIn: 'root' })
export class DashboardHintService {
  /** `userId` is undefined while the current user is not loaded yet. */
  hadRepositories(userId: number | undefined): boolean {
    const hint = this.read();
    return hint !== undefined && hint.has && (userId === undefined || hint.userId === userId);
  }

  remember(userId: number, has: boolean): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ userId, has } satisfies Hint));
    } catch {
      // Only a hint: without storage the full guide shows until the list loads.
    }
  }

  private read(): Hint | undefined {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      const { userId, has } = (value ?? {}) as Partial<Hint>;
      return typeof userId === 'number' && typeof has === 'boolean' ? { userId, has } : undefined;
    } catch {
      return undefined;
    }
  }
}
