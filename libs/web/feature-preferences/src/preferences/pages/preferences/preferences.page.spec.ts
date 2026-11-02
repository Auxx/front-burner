import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ApiError, CommitAuthorPreference } from '@front-burner/shared-contracts';
import { PreferencesApi } from '@front-burner/web-api-client';
import { NEVER, type Observable, of, Subject, throwError } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { PreferencesPage } from './preferences.page';

const KEY = 'web-feature-preferences.PreferencesPage';
const FORM = 'web-repository-dialogs.CommitAuthorFormComponent';
const ERRORS = 'web-repository-dialogs.errors';

const ada: CommitAuthorPreference = { author: { name: 'Ada', email: 'ada@example.com' }, confirmed: false };
const edited: CommitAuthorPreference = { author: { name: 'Ada L', email: 'me@nas' }, confirmed: true };

function refused(status: number, error: Partial<ApiError>): Observable<never> {
  const body = { code: 'validation-failed', message: 'Refused', params: {}, requestId: 'req-1', ...error };
  return throwError(() => new HttpErrorResponse({ status, error: body }));
}

describe('PreferencesPage', () => {
  let fixture: ComponentFixture<PreferencesPage>;
  let api: { commitAuthor: ReturnType<typeof vi.fn>; setCommitAuthor: ReturnType<typeof vi.fn>; };

  const page = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [ ...page().querySelectorAll('button') ].find(element => element.textContent?.trim() === `${KEY}.${text}`);
  const input = (label: string) =>
    [ ...page().querySelectorAll<HTMLElement>('ui-field') ]
      .find(field => field.querySelector('.label')?.textContent?.trim() === `${FORM}.${label}`)
      ?.querySelector('input') as HTMLInputElement;
  const errorOf = (label: string) => input(label).closest('ui-field')?.querySelector('.error')?.textContent?.trim();
  const live = () => page().querySelector('[aria-live="polite"]')?.textContent?.trim();

  async function open(...answers: Observable<CommitAuthorPreference>[]): Promise<void> {
    api = { commitAuthor: vi.fn(), setCommitAuthor: vi.fn() };
    answers.forEach(answer => api.commitAuthor.mockReturnValueOnce(answer));
    await TestBed.configureTestingModule({
      imports: [ PreferencesPage, translocoTesting() ],
      providers: [ provideRouter([]), { provide: PreferencesApi, useValue: api } ]
    }).compileComponents();
    fixture = TestBed.createComponent(PreferencesPage);
    await settle(fixture);
  }

  async function click(element: HTMLElement | undefined): Promise<void> {
    if (!element) {
      throw new Error('Nothing to click');
    }
    element.click();
    await settle(fixture);
  }

  async function enter(label: string, text: string): Promise<void> {
    input(label).value = text;
    input(label).dispatchEvent(new Event('input'));
    await settle(fixture);
  }

  it('shows the default commit author with Edit', async () => {
    await open(of(ada));

    expect(page().querySelector('h1')?.textContent?.trim()).toBe(`${KEY}.heading`);
    expect(page().textContent).toContain('Ada');
    expect(page().textContent).toContain('ada@example.com');
    expect(button('edit')).toBeTruthy();
    expect(page().querySelector('input')).toBeNull();
  });

  it('shows the way back to the dashboard above the heading (NV-14)', async () => {
    await open(of(ada));

    const link = page().querySelector('nav a');
    expect(link?.getAttribute('href')).toBe('/');
    expect(link?.textContent?.trim()).toBe(`${KEY}.dashboard`);
  });

  it('shows no form and no Edit while loading', async () => {
    await open(NEVER);

    expect(button('edit')).toBeUndefined();
    expect(page().querySelector('input')).toBeNull();
    expect(page().querySelector('ui-spinner')).toBeTruthy();
  });

  it('offers Try again when loading fails', async () => {
    await open(refused(500, { code: 'internal' }), of(ada));

    expect(page().textContent).toContain(`${KEY}.loadFailed`);
    expect(page().querySelector('input')).toBeNull();
    expect(button('edit')).toBeUndefined();

    await click(button('retry'));

    expect(api.commitAuthor).toHaveBeenCalledTimes(2);
    expect(page().textContent).toContain('ada@example.com');
    expect(page().textContent).not.toContain(`${KEY}.loadFailed`);
  });

  it('prefills the form with the author on Edit', async () => {
    await open(of(ada));

    await click(button('edit'));

    expect(input('name').value).toBe('Ada');
    expect(input('email').value).toBe('ada@example.com');
    expect(button('save')).toBeTruthy();
    expect(button('cancel')).toBeTruthy();
    expect(button('edit')).toBeUndefined();
  });

  it('saves an edited author', async () => {
    await open(of(ada));
    await click(button('edit'));
    api.setCommitAuthor.mockReturnValue(of(edited));

    await enter('name', 'Ada L');
    await enter('email', 'me@nas');
    await click(button('save'));

    expect(api.setCommitAuthor).toHaveBeenCalledExactlyOnceWith({ name: 'Ada L', email: 'me@nas' });
    expect(page().querySelector('input')).toBeNull();
    expect(page().textContent).toContain('me@nas');
    expect(page().textContent).not.toContain('ada@example.com');
    expect(live()).toBe(`${KEY}.saved`);
  });

  it('keeps the place for the Saved message while nothing is saved, so that the message is announced', async () => {
    await open(NEVER);

    expect(page().querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(live()).toBe('');
  });

  it('forgets Saved on the next Edit', async () => {
    await open(of(ada));
    await click(button('edit'));
    api.setCommitAuthor.mockReturnValue(of(edited));
    await click(button('save'));

    await click(button('edit'));

    expect(live()).toBe('');
    expect(input('name').value).toBe('Ada L');
  });

  it('disables Save while it is saving', async () => {
    await open(of(ada));
    await click(button('edit'));
    const answer = new Subject<CommitAuthorPreference>();
    api.setCommitAuthor.mockReturnValue(answer);

    await click(button('save'));
    expect(button('save')?.getAttribute('aria-disabled')).toBe('true');

    await click(button('save'));
    page().querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(api.setCommitAuthor).toHaveBeenCalledTimes(1);

    answer.next(edited);
    answer.complete();
    await settle(fixture);
    expect(live()).toBe(`${KEY}.saved`);
  });

  it('sends nothing while the form breaks the rules, and shows why', async () => {
    await open(of(ada));
    await click(button('edit'));

    await enter('email', 'no-at-sign');
    await click(button('save'));

    expect(api.setCommitAuthor).not.toHaveBeenCalled();
    expect(errorOf('email')).toBe(`${ERRORS}.email.email-invalid`);
  });

  it('can correct a stored default that breaks the rules (CA-7)', async () => {
    await open(of({ author: { name: 'Ada', email: 'not an email' }, confirmed: false }));
    await click(button('edit'));
    api.setCommitAuthor.mockReturnValue(of(edited));

    await enter('email', 'me@nas');
    await click(button('save'));

    expect(api.setCommitAuthor).toHaveBeenCalledTimes(1);
  });

  it('shows the backend\'s refusal on the field, until that field changes', async () => {
    await open(of(ada));
    await click(button('edit'));
    api.setCommitAuthor.mockReturnValue(refused(422, {
      fields: [
        { path: 'name', code: 'name-invalid', params: {} },
        { path: 'email', code: 'email-invalid', params: {} }
      ]
    }));

    await click(button('save'));

    expect(errorOf('name')).toBe(`${ERRORS}.name.name-invalid`);
    expect(errorOf('email')).toBe(`${ERRORS}.email.email-invalid`);
    expect(page().querySelector('ui-inline-banner')).toBeNull();
    expect(input('name')).toBeTruthy();

    await enter('name', 'Ada L');

    expect(errorOf('name')).toBeUndefined();
    expect(errorOf('email')).toBe(`${ERRORS}.email.email-invalid`);
  });

  it('shows any other failure above the buttons, keeping what was typed', async () => {
    await open(of(ada));
    await click(button('edit'));
    api.setCommitAuthor.mockReturnValue(refused(500, { code: 'internal', message: 'It broke' }));

    await enter('name', 'Ada L');
    await click(button('save'));

    expect(page().querySelector('ui-inline-banner')?.textContent).toContain('It broke');
    expect(page().querySelector('ui-inline-banner')?.textContent).toContain('req-1');
    expect(input('name').value).toBe('Ada L');
    expect(live()).toBe('');
  });

  it('Cancel drops the edit and asks the backend nothing', async () => {
    await open(of(ada));
    await click(button('edit'));
    await enter('name', 'Someone else');

    await click(button('cancel'));

    expect(api.setCommitAuthor).not.toHaveBeenCalled();
    expect(page().textContent).toContain('ada@example.com');
    expect(page().textContent).not.toContain('Someone else');

    await click(button('edit'));
    expect(input('name').value).toBe('Ada');
  });

  it('moves the focus into the form on Edit, and back to Edit afterwards', async () => {
    await open(of(ada));
    document.body.append(page());

    await click(button('edit'));
    expect(document.activeElement).toBe(input('name'));

    await click(button('cancel'));
    expect(document.activeElement).toBe(button('edit'));
    page().remove();
  });
});
