import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { DraftOfferComponent } from './draft-offer.component';

const K = 'web-feature-repository-screen.DraftOfferComponent';
const SAVED_AT = '2026-10-29T10:05:00.000Z';

describe('DraftOfferComponent', () => {
  let fixture: ComponentFixture<DraftOfferComponent>;

  const offer = () => fixture.nativeElement as HTMLElement;
  const buttons = () => [ ...offer().querySelectorAll<HTMLButtonElement>('[uiBannerActions] button') ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [
        DraftOfferComponent,
        translocoTesting({ [`${K}.message`]: 'You have unsaved changes from {{ time }}' })
      ]
    });
    fixture = TestBed.createComponent(DraftOfferComponent);
    fixture.componentRef.setInput('draft', { content: '# Draft', savedAt: SAVED_AT });
    await settle(fixture);
  });

  it('says when the unsaved changes are from, in the browser\'s locale', () => {
    const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(SAVED_AT));

    expect(offer().querySelector('ui-inline-banner')?.textContent).toContain(
      `You have unsaved changes from ${time}`
    );
  });

  it('offers Restore and Discard as buttons', () => {
    const emitted: string[] = [];
    fixture.componentInstance.restore.subscribe(() => emitted.push('restore'));
    fixture.componentInstance.discard.subscribe(() => emitted.push('discard'));

    expect(buttons().map(button => button.textContent?.trim())).toEqual([ `${K}.restore`, `${K}.discard` ]);
    buttons()[0].click();
    buttons()[1].click();

    expect(emitted).toEqual([ 'restore', 'discard' ]);
  });
});
