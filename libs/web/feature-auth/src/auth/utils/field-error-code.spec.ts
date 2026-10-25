import { fieldErrorCode } from './field-error-code';

describe('fieldErrorCode', () => {
  it('uses the policy code of a schema issue', () => {
    expect(fieldErrorCode({
      kind: 'standardSchema',
      issue: { message: 'm', code: 'custom', params: { code: 'too-short' } }
    } as never)).toBe('too-short');
  });

  it('turns a Zod code into the API form', () => {
    expect(fieldErrorCode({ kind: 'standardSchema', issue: { message: 'm', code: 'invalid_format' } } as never))
      .toBe('invalid-format');
  });

  it('uses the kind of any other error', () => {
    expect(fieldErrorCode({ kind: 'mismatch' } as never)).toBe('mismatch');
  });
});
