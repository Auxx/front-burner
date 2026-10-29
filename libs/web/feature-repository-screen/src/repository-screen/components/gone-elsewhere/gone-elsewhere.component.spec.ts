import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ApiError } from '@front-burner/shared-contracts';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { GoneElsewhereComponent } from './gone-elsewhere.component';

const K = 'web-feature-repository-screen.GoneElsewhereComponent';

function error(code: string): ApiError {
  return { code, params: {}, requestId: 'r1', message: code };
}

describe('GoneElsewhereComponent', () => {
  let fixture: ComponentFixture<GoneElsewhereComponent>;

  const banner = () => fixture.nativeElement as HTMLElement;
  const text = () => banner().querySelector('ui-inline-banner')?.textContent ?? '';
  const buttons = () => [ ...banner().querySelectorAll<HTMLButtonElement>('[uiBannerActions] button') ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [
        GoneElsewhereComponent,
        translocoTesting({
          [`${K}.message`]: 'This file was deleted or renamed elsewhere.',
          [`${K}.exists`]: 'A file with this name exists again.'
        })
      ]
    });
    fixture = TestBed.createComponent(GoneElsewhereComponent);
    await settle(fixture);
  });

  it('says the file was deleted or renamed elsewhere, with Recreate it', () => {
    const recreated = vi.fn();
    fixture.componentInstance.recreate.subscribe(recreated);

    expect(text()).toContain('This file was deleted or renamed elsewhere.');
    expect(buttons().map(button => button.textContent?.trim())).toEqual([ `${K}.recreate` ]);
    buttons()[0].click();

    expect(recreated).toHaveBeenCalled();
  });

  it('says when a file with this name exists again', async () => {
    fixture.componentRef.setInput('error', error('entry-exists'));
    await settle(fixture);

    expect(text()).toContain('A file with this name exists again.');
    expect(buttons()).toHaveLength(0);
  });

  it('says why another recreate failed, and offers Recreate it again', async () => {
    fixture.componentRef.setInput('error', error('internal'));
    await settle(fixture);

    expect(text()).toContain(`${K}.failed`);
    expect(buttons().map(button => button.textContent?.trim())).toEqual([ `${K}.recreate` ]);
  });
});
