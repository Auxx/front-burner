import { TestBed } from '@angular/core/testing';
import type { ApiError } from '@front-burner/shared-contracts';

import { commitAuthorForm } from './commit-author-form.model';
import { CommitAuthorRefusals } from './commit-author-refusals';

const ada = { name: 'Ada', email: 'ada@example.com' };

function refusal(...fields: { path: string; code: string; }[]): ApiError {
  return {
    code: 'validation-failed',
    message: 'Refused',
    params: {},
    requestId: 'req-1',
    fields: fields.map(field => ({ ...field, params: {} }))
  };
}

describe('CommitAuthorRefusals', () => {
  const setUp = () => {
    const model = TestBed.runInInjectionContext(() => commitAuthorForm(ada));
    return { model, refusals: new CommitAuthorRefusals(model) };
  };

  it('takes the field errors of the form\'s fields', () => {
    const { refusals } = setUp();

    expect(refusals.record(ada, refusal({ path: 'email', code: 'email-invalid' }))).toBe(true);

    expect(refusals.errors().map(error => error.path)).toEqual([ 'email' ]);
  });

  it.each([
    [ 'no field errors', refusal() ],
    [ 'errors on other fields only', refusal({ path: 'other', code: 'too-big' }) ]
  ])('leaves a failure with %s to the caller', (_name, error) => {
    const { refusals } = setUp();

    expect(refusals.record(ada, error)).toBe(false);

    expect(refusals.errors()).toEqual([]);
  });

  it('keeps each error until its own field changes', () => {
    const { model, refusals } = setUp();
    refusals.record(ada, refusal({ path: 'name', code: 'name-invalid' }, { path: 'email', code: 'email-invalid' }));

    model.name().value.set('Ada L');

    expect(refusals.errors().map(error => error.path)).toEqual([ 'email' ]);
  });

  it('forgets everything on clear', () => {
    const { refusals } = setUp();
    refusals.record(ada, refusal({ path: 'name', code: 'name-invalid' }));

    refusals.clear();

    expect(refusals.errors()).toEqual([]);
  });

  it('focuses the first field in error, refused or invalid', () => {
    const { model, refusals } = setUp();
    const name = vi.spyOn(model.name(), 'focusBoundControl');
    const email = vi.spyOn(model.email(), 'focusBoundControl');

    refusals.record(ada, refusal({ path: 'email', code: 'email-invalid' }));
    refusals.focusFirstError();
    expect(email).toHaveBeenCalledTimes(1);
    expect(name).not.toHaveBeenCalled();

    model.name().value.set('');
    refusals.focusFirstError();
    expect(name).toHaveBeenCalledTimes(1);
  });
});
