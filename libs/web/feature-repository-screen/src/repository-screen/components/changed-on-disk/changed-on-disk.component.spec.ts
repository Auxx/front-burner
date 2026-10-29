import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { ChangedOnDiskComponent } from './changed-on-disk.component';

const K = 'web-feature-repository-screen.ChangedOnDiskComponent';

describe('ChangedOnDiskComponent', () => {
  let fixture: ComponentFixture<ChangedOnDiskComponent>;

  const banner = () => fixture.nativeElement as HTMLElement;
  const buttons = () => [ ...banner().querySelectorAll<HTMLButtonElement>('[uiBannerActions] button') ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [
        ChangedOnDiskComponent,
        translocoTesting({ [`${K}.message`]: 'This file changed while you were editing.' })
      ]
    });
    fixture = TestBed.createComponent(ChangedOnDiskComponent);
    await settle(fixture);
  });

  it('says the file changed while the user was editing', () => {
    expect(banner().querySelector('ui-inline-banner')?.textContent).toContain(
      'This file changed while you were editing.'
    );
  });

  it('offers Reload and Keep mine as buttons', () => {
    const emitted: string[] = [];
    fixture.componentInstance.reload.subscribe(() => emitted.push('reload'));
    fixture.componentInstance.keepMine.subscribe(() => emitted.push('keepMine'));

    expect(buttons().map(button => button.textContent?.trim())).toEqual([ `${K}.reload`, `${K}.keepMine` ]);
    buttons()[0].click();
    buttons()[1].click();

    expect(emitted).toEqual([ 'reload', 'keepMine' ]);
  });
});
