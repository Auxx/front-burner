import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RepositoryDetails } from '@front-burner/shared-contracts';
import { ToastService } from '@front-burner/ui';

import { repositoryDetails } from '../../../testing/repository-details';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { CloneStatusComponent } from './clone-status.component';

const KEY = 'web-feature-repositories.CloneStatusComponent';
const DETAIL = 'web-shell.RepositoryStatusDetailComponent';

/** A failed clone, with git's error and the request ID. */
function failed(extra: Partial<Omit<RepositoryDetails, 'summary'>> = {}): RepositoryDetails {
  return repositoryDetails(
    { status: 'error', error: 'clone-failed' },
    { errorDetail: 'fatal: repository not found', errorRequestId: 'req-0123456789', ...extra }
  );
}

describe('CloneStatusComponent', () => {
  let fixture: ComponentFixture<CloneStatusComponent>;
  let toast: { show: ReturnType<typeof vi.fn>; };

  const host = () => fixture.nativeElement as HTMLElement;
  const detailsButton = () => host().querySelector<HTMLButtonElement>('button.toggle');
  const region = () => host().querySelector('ui-collapsible');
  const message = () => host().querySelector('pre.message');
  const copyButton = () => host().querySelector<HTMLButtonElement>('button.copy');

  async function show(details: RepositoryDetails): Promise<void> {
    toast = { show: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [ CloneStatusComponent, translocoTesting() ],
      providers: [ { provide: ToastService, useValue: toast } ]
    }).compileComponents();
    fixture = TestBed.createComponent(CloneStatusComponent);
    fixture.componentRef.setInput('details', details);
    await settle(fixture);
  }

  it('is a section named by its heading', async () => {
    await show(failed());

    const heading = host().querySelector('h2');
    expect(heading?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(host().querySelector('section')?.getAttribute('aria-labelledby')).toBe(heading?.id);
  });

  it('shows progress while cloning', async () => {
    await show(repositoryDetails({ status: 'cloning', clone: { jobId: 3, state: 'running', percent: 42 } }));

    expect(host().querySelector('ui-progress-bar')?.getAttribute('aria-valuenow')).toBe('42');
    expect(detailsButton()).toBeNull();
  });

  it('says it is waiting for other clones', async () => {
    await show(repositoryDetails({ status: 'cloning', clone: { jobId: 3, state: 'waiting', percent: null } }));

    expect(host().textContent).toContain(`${DETAIL}.waiting`);
    expect(host().querySelector('ui-progress-bar')).toBeNull();
  });

  it('shows the error\'s label', async () => {
    await show(failed());

    expect(host().querySelector('shell-repository-status-detail')?.textContent?.trim()).toBe(
      `${DETAIL}.error.clone-failed`
    );
  });

  it('keeps Details closed at first, and opens it', async () => {
    await show(failed());

    const button = detailsButton();
    expect(button?.textContent?.trim()).toBe(`${KEY}.details`);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-controls')).toBe(region()?.id);
    expect(region()?.hasAttribute('inert')).toBe(true);

    button?.click();
    await settle(fixture);

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(region()?.hasAttribute('inert')).toBe(false);
  });

  it('shows git\'s error as text', async () => {
    await show(failed({ errorDetail: 'fatal: <img src=x onerror="alert(1)"> not found' }));

    expect(message()?.textContent).toBe('fatal: <img src=x onerror="alert(1)"> not found');
    expect(message()?.querySelector('img')).toBeNull();
  });

  it('shows the request ID with Copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await show(failed());

    expect(host().querySelector('.request')?.textContent).toContain(`${KEY}.requestId`);
    expect(host().querySelector('.request code')?.textContent).toBe('req-0123456789');
    expect(copyButton()?.getAttribute('aria-label')).toBe(`${KEY}.copyLabel`);

    copyButton()?.click();
    await settle(fixture);

    expect(writeText).toHaveBeenCalledWith('req-0123456789');
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ message: `${KEY}.copied`, status: 'success' }));
  });

  it('says when git recorded no message', async () => {
    await show(failed({ errorDetail: null, errorRequestId: null }));

    expect(message()).toBeNull();
    expect(host().querySelector('.no-message')?.textContent?.trim()).toBe(`${KEY}.noMessage`);
    expect(host().querySelector('.request')).toBeNull();
  });

  it('shows the request ID without a message', async () => {
    await show(failed({ errorDetail: null }));

    expect(host().querySelector('.no-message')).not.toBeNull();
    expect(host().querySelector('.request code')?.textContent).toBe('req-0123456789');
  });

  it('is hidden for a ready repository', async () => {
    await show(repositoryDetails());

    expect(host().querySelector('section')).toBeNull();
    expect(host().classList).toContain('none');
  });
});
