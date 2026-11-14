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

  it('can be dismissed', () => {
    let dismissed = 0;
    fixture.componentInstance.dismissed.subscribe(() => dismissed++);

    button('Dismiss')?.click();

    expect(dismissed).toBe(1);
  });
});
