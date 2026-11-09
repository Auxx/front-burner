import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RemoteChangeNoticeComponent } from './remote-change-notice.component';

const KEY = 'web-feature-repository-screen.RemoteChangeNoticeComponent';

describe('RemoteChangeNoticeComponent', () => {
  let fixture: ComponentFixture<RemoteChangeNoticeComponent>;
  let announce: ReturnType<typeof vi.fn>;

  const element = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [ ...element().querySelectorAll<HTMLButtonElement>('button') ].find(found =>
      found.textContent?.trim() === text || found.getAttribute('aria-label') === text
    );

  async function show(commits: number, touchesOpenFile: boolean): Promise<void> {
    fixture.componentRef.setInput('notice', { commits, upstream: 'origin/main', touchesOpenFile });
    await settle(fixture);
  }

  beforeEach(() => {
    announce = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [
        RemoteChangeNoticeComponent,
        translocoTesting({
          // Plurals need the application's transpiler; the end-to-end tests see them.
          [`${KEY}.commits`]: '{{ count }} new commits on {{ upstream }}',
          [`${KEY}.openFileChanged`]: 'This file changed too.'
        })
      ],
      providers: [ { provide: LiveAnnouncer, useValue: { announce } } ]
    });
    fixture = TestBed.createComponent(RemoteChangeNoticeComponent);
  });

  it('says how many commits, and where', async () => {
    await show(3, false);

    expect(element().textContent).toContain('3 new commits on origin/main');
    expect(element().textContent).not.toContain('This file changed too.');
  });

  it('adds This file changed too., and announces the whole message once', async () => {
    await show(2, true);

    expect(element().textContent).toContain('This file changed too.');
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      '2 new commits on origin/main This file changed too.',
      'polite'
    );

    await show(2, false);

    expect(element().textContent).not.toContain('This file changed too.');
    expect(announce).toHaveBeenCalledOnce();
  });

  it('offers Pull', async () => {
    await show(3, false);
    let pulls = 0;
    fixture.componentInstance.pull.subscribe(() => pulls++);

    button(`${KEY}.pull`)?.click();

    expect(pulls).toBe(1);
  });

  it('can be dismissed', async () => {
    await show(3, false);
    let dismissed = 0;
    fixture.componentInstance.dismissed.subscribe(() => dismissed++);

    button(`${KEY}.dismiss`)?.click();

    expect(dismissed).toBe(1);
  });
});
