import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MergeCommittedComponent } from './merge-committed.component';

const K = 'web-feature-repository-screen.MergeCommittedComponent';

describe('MergeCommittedComponent', () => {
  let fixture: ComponentFixture<MergeCommittedComponent>;
  let announce: ReturnType<typeof vi.fn>;

  const element = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [ ...element().querySelectorAll<HTMLButtonElement>('button') ].find(found =>
      found.textContent?.trim() === text || found.getAttribute('aria-label') === text
    );

  beforeEach(async () => {
    announce = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [
        MergeCommittedComponent,
        translocoTesting({
          [`${K}.message`]: 'Merge committed. Push to publish it.',
          [`${K}.push`]: 'Push',
          [`${K}.undo`]: 'Undo merge',
          [`${K}.dismiss`]: 'Dismiss'
        })
      ],
      providers: [ { provide: LiveAnnouncer, useValue: { announce } } ]
    });
    fixture = TestBed.createComponent(MergeCommittedComponent);
    await settle(fixture);
  });

  it('says that the merge was committed, and announces it', () => {
    expect(element().textContent).toContain('Merge committed. Push to publish it.');
    expect(announce).toHaveBeenCalledExactlyOnceWith('Merge committed. Push to publish it.', 'polite');
  });

  it('offers Push', () => {
    let pushed = 0;
    fixture.componentInstance.push.subscribe(() => pushed++);

    button('Push')?.click();

    expect(pushed).toBe(1);
  });

  it('offers Undo merge', () => {
    let undone = 0;
    fixture.componentInstance.undo.subscribe(() => undone++);

    button('Undo merge')?.click();

    expect(undone).toBe(1);
  });

  it('shows an undo running, and offers neither Push nor Undo merge meanwhile', async () => {
    let chosen = 0;
    fixture.componentInstance.push.subscribe(() => chosen++);
    fixture.componentInstance.undo.subscribe(() => chosen++);
    fixture.componentRef.setInput('undoing', true);
    await settle(fixture);

    expect(button('Undo merge')?.getAttribute('data-busy')).toBe('true');
    expect(button('Push')?.getAttribute('aria-disabled')).toBe('true');
    button('Undo merge')?.click();
    button('Push')?.click();

    expect(chosen).toBe(0);
  });

  it('does not offer Undo merge while another git action runs, and still offers Push', async () => {
    let undone = 0;
    fixture.componentInstance.undo.subscribe(() => undone++);
    fixture.componentRef.setInput('undoBlocked', true);
    await settle(fixture);

    expect(button('Undo merge')?.getAttribute('aria-disabled')).toBe('true');
    expect(button('Push')?.getAttribute('aria-disabled')).toBeNull();
    button('Undo merge')?.click();

    expect(undone).toBe(0);
  });

  it('can be dismissed', () => {
    let dismissed = 0;
    fixture.componentInstance.dismissed.subscribe(() => dismissed++);

    button('Dismiss')?.click();

    expect(dismissed).toBe(1);
  });
});
