import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { SaveStatus } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { SaveStatusComponent } from './save-status.component';

const K = 'web-feature-repository-screen.SaveStatusComponent';

describe('SaveStatusComponent', () => {
  let fixture: ComponentFixture<SaveStatusComponent>;

  const host = () => fixture.nativeElement as HTMLElement;

  async function show(status: SaveStatus | null): Promise<void> {
    fixture.componentRef.setInput('status', status);
    await settle(fixture);
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ SaveStatusComponent, translocoTesting({ 'errors.entry-not-found': 'This file doesn\'t exist.' }) ]
    });
    fixture = TestBed.createComponent(SaveStatusComponent);
    await settle(fixture);
  });

  it.each<[ SaveStatus, string ]>([
    [ { kind: 'saved' }, `${K}.saved` ],
    [ { kind: 'saving' }, `${K}.saving` ],
    [ { kind: 'offline' }, `${K}.offline` ],
    [ { kind: 'refused', code: 'file-too-large' }, `${K}.tooLarge` ],
    [ { kind: 'refused', code: 'merge-in-progress' }, `${K}.mergeInProgress` ]
  ])('shows each status\'s text: %o', async (status, text) => {
    await show(status);

    expect(host().textContent?.trim()).toBe(text);
  });

  it('shows "Not saved" with the error\'s text for any other refusal', async () => {
    await show({ kind: 'refused', code: 'entry-not-found' });

    expect(host().textContent?.trim()).toBe(`${K}.refused`);
  });

  it('shows nothing without a file', async () => {
    await show(null);

    expect(host().textContent?.trim()).toBe('');
  });

  it('announces the status politely', async () => {
    await show({ kind: 'saving' });

    expect(host().getAttribute('role')).toBe('status');
    expect(host().getAttribute('aria-live')).toBe('polite');
  });
});
