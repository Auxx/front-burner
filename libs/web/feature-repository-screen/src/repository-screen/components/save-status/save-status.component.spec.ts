import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { SaveStatus } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { SaveStatusComponent } from './save-status.component';

const K = 'web-feature-repository-screen.SaveStatusComponent';

function refused(code: string, params: Record<string, string> = {}): SaveStatus {
  return { kind: 'refused', code, error: { code, params, requestId: 'r1', message: code } };
}

describe('SaveStatusComponent', () => {
  let fixture: ComponentFixture<SaveStatusComponent>;

  const host = () => fixture.nativeElement as HTMLElement;

  async function show(status: SaveStatus | null): Promise<void> {
    fixture.componentRef.setInput('status', status);
    await settle(fixture);
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [
        SaveStatusComponent,
        translocoTesting({
          'errors.entry-not-found': 'This file doesn\'t exist.',
          'errors.name-invalid': 'The name {{ name }} can\'t be used.',
          [`${K}.refused`]: 'Not saved — {{ reason }}'
        })
      ]
    });
    fixture = TestBed.createComponent(SaveStatusComponent);
    await settle(fixture);
  });

  it.each<[ SaveStatus, string ]>([
    [ { kind: 'saved' }, `${K}.saved` ],
    [ { kind: 'saving' }, `${K}.saving` ],
    [ { kind: 'offline' }, `${K}.offline` ],
    [ refused('file-too-large'), `${K}.tooLarge` ],
    [ refused('merge-in-progress'), `${K}.mergeInProgress` ],
    [ refused('changed-on-disk'), `${K}.notSaved` ]
  ])('shows each status\'s text: %o', async (status, text) => {
    await show(status);

    expect(host().textContent?.trim()).toBe(text);
  });

  it('shows "Not saved" with the error\'s text for any other refusal', async () => {
    await show(refused('entry-not-found'));

    expect(host().textContent?.trim()).toBe('Not saved — This file doesn\'t exist.');
  });

  it('gives the error\'s text its parameters', async () => {
    await show(refused('name-invalid', { name: 'a:b.md' }));

    expect(host().textContent?.trim()).toBe('Not saved — The name a:b.md can\'t be used.');
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
