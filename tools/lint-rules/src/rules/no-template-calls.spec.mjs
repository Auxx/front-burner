import { ruleTester } from '../testing/rule-tester.mjs';
import rule from './no-template-calls.mjs';

const options = [ { allowedFunctions: [ 't', 'e', 'root' ] } ];

ruleTester.run('no-template-calls', rule, {
  valid: [
    '{{ label() }}',
    '{{ viewMode.editorShown() }}',
    '{{ t(\'key\') }}',
    '{{ e(reason()) }}',
    '{{ root(\'a.b\') }}',
    '<button (click)="save(item)"></button>',
    '<button (click)="ref.close(); x.set(1)"></button>',
    '{{ value | date: \'short\' }}',
    '@if (user(); as u) {}',
    '<x [(value)]="v" />'
  ].map(code => ({ code, options })),
  invalid: [
    '{{ value(token, scheme) }}',
    '@let x = error(\'issuer\');',
    '{{ list().join(\' + \') }}',
    '{{ key(option.value)?.fingerprint }}',
    '<a [title]="format(x)"></a>',
    '{{ l(\'key\') }}',
    '@if (isOpen(id)) {}',
    '{{ fn?.(a) }}',
    '@for (i of items(); track id(i)) {}'
  ].map(code => ({ code, options, errors: [ { messageId: 'call' } ] }))
});
