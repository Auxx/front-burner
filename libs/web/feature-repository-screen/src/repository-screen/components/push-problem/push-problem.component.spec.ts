import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import type { PushProblem } from '../../services/push/push.service';
import { pushProblem } from '../../utils/push-problem/push-problem';
import { PushProblemComponent } from './push-problem.component';

const KEY = 'web-feature-repository-screen.PushProblemComponent';

function problem(code: string, params: Record<string, string> = {}, quiet = false): PushProblem {
  return { code, params, quiet, ...pushProblem(code) };
}

describe('PushProblemComponent', () => {
  let fixture: ComponentFixture<PushProblemComponent>;
  let announce: ReturnType<typeof vi.fn>;
  let fixes: PushProblem['fix'][];
  let dismissed: number;

  const element = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim();
  const buttons = () => [ ...element().querySelectorAll('[uiBannerActions] button') ].map(text);

  async function show(shown: PushProblem): Promise<void> {
    announce = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [
        PushProblemComponent,
        translocoTesting({
          'errors.push-non-fast-forward': 'The remote has new commits. Pull first.',
          'errors.push-rejected': 'The remote refused the push.',
          'errors.remote-timeout': '{{ host }} didn\'t answer in time. Try again later.'
        })
      ],
      providers: [ { provide: LiveAnnouncer, useValue: { announce } } ]
    });
    fixture = TestBed.createComponent(PushProblemComponent);
    fixture.componentRef.setInput('problem', shown);
    fixes = [];
    dismissed = 0;
    fixture.componentInstance.fixSelected.subscribe(fix => fixes.push(fix));
    fixture.componentInstance.dismissed.subscribe(() => dismissed++);
    await settle(fixture);
  }

  it('says The remote has new commits. Pull first. and forces nothing', async () => {
    await show(problem('push-non-fast-forward', { branch: 'main' }));

    expect(text(element().querySelector('ui-inline-banner'))).toContain('The remote has new commits. Pull first.');
    // **Pull** comes with step 4; nothing else is offered, a force push least of all.
    expect(buttons()).toEqual([]);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('Pull first.'), 'polite');
  });

  it('shows the remote\'s lines as text', async () => {
    const lines = 'remote: <img src=x onerror="alert(1)">\nremote: <b>Push refused by hook</b>';
    await show(problem('push-rejected', { branch: 'main', remoteMessages: lines }));

    const pre = element().querySelector('pre') as HTMLElement;
    expect(pre.textContent).toBe(lines);
    expect(pre.querySelector('img, b')).toBeNull();
  });

  it('offers Try again for a network failure', async () => {
    await show(problem('remote-timeout', { host: 'github.com' }));

    expect(text(element().querySelector('ui-inline-banner'))).toContain('github.com didn\'t answer in time.');
    expect(buttons()).toEqual([ `${KEY}.fixes.retry` ]);
    (element().querySelector('[uiBannerActions] button') as HTMLButtonElement).click();

    expect(fixes).toEqual([ 'retry' ]);
  });

  it('shows a fix whose dialog does not exist yet without a button', async () => {
    await show(problem('credentials-refused'));

    expect(buttons()).toEqual([]);
  });

  it('does not announce a quiet problem', async () => {
    await show(problem('push-rejected', {}, true));

    expect(text(element().querySelector('ui-inline-banner'))).toContain('The remote refused the push.');
    expect(announce).not.toHaveBeenCalled();
  });

  it('can be dismissed', async () => {
    await show(problem('push-rejected'));

    (element().querySelector(`button[aria-label="${KEY}.dismiss"]`) as HTMLButtonElement).click();

    expect(dismissed).toBe(1);
  });
});
