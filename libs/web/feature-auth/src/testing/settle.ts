import type { ComponentFixture } from '@angular/core/testing';

/** Lets promise chains that follow a flushed request finish, then renders. */
export async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await new Promise(resolve => setTimeout(resolve));
  await fixture.whenStable();
}
