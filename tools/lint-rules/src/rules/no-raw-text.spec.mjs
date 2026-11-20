import { ruleTester } from '../testing/rule-tester.mjs';
import rule from './no-raw-text.mjs';

ruleTester.run('no-raw-text', rule, {
  valid: [
    '<p>{{ t(\'key\') }}</p>',
    '<p>{{ t(\'a\') }} · {{ t(\'b\') }}</p>',
    '<span> / </span>',
    '<button [attr.aria-label]="t(\'close\')"></button>',
    '<input [placeholder]="t(\'filter\')" />',
    '<img alt="" src="x.png" />',
    '<ui-icon name="close" />',
    '<a href="/repositories" class="link"></a>',
    '<p>{{ count() }}</p>',
    '@if (open()) { <p>{{ t(\'key\') }}</p> }',
    '<code>https://github.com/org/repo.git</code>',
    '<p>{{ t(\'press\') }} <kbd>Ctrl</kbd></p>',
    '<pre><code>git push <span>origin</span> {{ branch() }}</code></pre>'
  ],
  invalid: [
    { code: '<p>Hello</p>', errors: [ { messageId: 'text' } ] },
    { code: '<p>Hello {{ name() }}</p>', errors: [ { messageId: 'text' } ] },
    { code: '<p>{{ count() }} files</p>', errors: [ { messageId: 'text' } ] },
    { code: '<p>Größe</p>', errors: [ { messageId: 'text' } ] },
    { code: '@if (open()) { <p>Open</p> }', errors: [ { messageId: 'text' } ] },
    {
      code: '<button aria-label="Close"></button>',
      errors: [ { messageId: 'attribute', data: { name: 'aria-label' } } ]
    },
    { code: '<span title="More"></span>', errors: [ { messageId: 'attribute', data: { name: 'title' } } ] },
    { code: '<input placeholder="Filter" />', errors: [ { messageId: 'attribute', data: { name: 'placeholder' } } ] },
    { code: '<img alt="Logo" src="x.png" />', errors: [ { messageId: 'attribute', data: { name: 'alt' } } ] }
  ]
});
