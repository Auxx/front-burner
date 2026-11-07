import { ruleTester } from '../testing/rule-tester.mjs';
import rule from './attribute-layout.mjs';

const lines = (...parts) => parts.join('\n');

/** Each invalid case's fixed output, which must itself be valid. */
const fixed = {
  badExample: lines(
    '<button uiButton',
    '        variant="ghost"',
    '        size="small"',
    '        class="how">x</button>'
  ),
  twoOnOneLine: lines('<a href="x"', '   class="y"></a>'),
  firstOnNextLine: '<div class="a"></div>',
  closingOnOwnLine: lines('<div a', '     b></div>'),
  selfClosing: '<ui-icon name="a" />',
  boundShiftedLeft: lines(
    '<div [x]="{',
    '       a: 1',
    '     }"',
    '     class="y"></div>'
  ),
  boundShiftedRight: lines(
    '<section [x]="{',
    '           a: 1',
    '         }"',
    '         id="y"></section>'
  ),
  crlf: '<a href="x"\r\n   class="y"></a>'
};

const valid = [
  '<div></div>',
  '<br>',
  '<div class="a"></div>',
  lines(
    '<button uiButton',
    '        variant="ghost"',
    '        size="small"',
    '        class="how">x</button>'
  ),
  { name: 'indented tag', code: lines('  <a href="x"', '     class="y"></a>') },
  lines('<ui-icon name="a"', '         size="s" />'),
  lines('<ng-template #a', '             let-item></ng-template>'),
  { name: 'mid-line', code: lines('<span>a</span> <b class="x"', '                  id="y"></b>') },
  { name: 'quoted-gt', code: lines('<div [x]="a > b"', '     (y)="go()"></div>') },
  { name: 'boolean-and-single-quotes', code: lines('<input disabled', '       title=\'x\'>') },
  {
    name: 'multi-line bound value',
    code: lines('<div [x]="{', '       a: 1', '     }"', '     class="y"></div>')
  },
  { name: 'structural directive', code: lines('<p *ngIf="a"', '   class="b"></p>') },
  { name: 'static multi-line value in place', code: lines('<div class="a', '  b"', '     id="c"></div>') }
];
const validCodes = new Set(valid.map(test => test.code ?? test));

ruleTester.run('attribute-layout', rule, {
  valid: [
    ...valid,
    // Fixing is idempotent: each fixed output is valid (RuleTester refuses duplicates).
    ...Object.entries(fixed)
      .filter(([ , code ]) => !validCodes.has(code))
      .map(([ name, code ]) => ({ name: `fixed: ${name}`, code }))
  ],
  invalid: [
    {
      name: 'the bad example',
      code: lines(
        '<button',
        '  uiButton',
        '  variant="ghost"',
        '  size="small"',
        '  class="how"',
        '>x</button>'
      ),
      output: fixed.badExample,
      errors: [ { messageId: 'firstAttribute' }, { messageId: 'closing' } ]
    },
    {
      name: 'two attributes on one line',
      code: '<a href="x" class="y"></a>',
      output: fixed.twoOnOneLine,
      errors: [ { messageId: 'alignAttribute' } ]
    },
    {
      name: 'first attribute on the next line',
      code: lines('<div', '  class="a"></div>'),
      output: fixed.firstOnNextLine,
      errors: [ { messageId: 'firstAttribute' } ]
    },
    {
      name: 'two spaces before the first attribute',
      code: '<div  class="a"></div>',
      output: fixed.firstOnNextLine,
      errors: [ { messageId: 'firstAttribute' } ]
    },
    {
      name: 'closing bracket on its own line',
      code: lines('<div a', '     b', '></div>'),
      output: fixed.closingOnOwnLine,
      errors: [ { messageId: 'closing' } ]
    },
    {
      name: 'self-closing tag without a space',
      code: '<ui-icon name="a"/>',
      output: fixed.selfClosing,
      errors: [ { messageId: 'closing' } ]
    },
    {
      name: 'misaligned attribute after a multi-line bound value',
      code: lines('<div  [x]="{', '        a: 1', '      }"', '     class="y"></div>'),
      output: fixed.boundShiftedLeft,
      errors: [ { messageId: 'firstAttribute' }, { messageId: 'alignAttribute' } ]
    },
    {
      name: 'bound multi-line value moved left by 2',
      code: lines('<div', '       [x]="{', '         a: 1', '       }"', '       class="y"></div>'),
      output: fixed.boundShiftedLeft,
      errors: [ { messageId: 'firstAttribute' } ]
    },
    {
      name: 'bound multi-line value moved right',
      code: lines('<section', '  [x]="{', '    a: 1', '  }"', '  id="y"></section>'),
      output: fixed.boundShiftedRight,
      errors: [ { messageId: 'firstAttribute' } ]
    },
    {
      name: 'bound value without room to shift left',
      code: lines('<div', '       [x]="{', ' a: 1', '}"></div>'),
      output: null,
      errors: [ { messageId: 'firstAttribute' } ]
    },
    {
      name: 'static multi-line value whose column changes',
      code: lines('<div', '  class="a', '    b"', '  id="c"></div>'),
      output: null,
      errors: [ { messageId: 'firstAttribute' } ]
    },
    {
      name: 'crlf',
      code: '<a href="x" class="y"></a>\r\n',
      output: `${fixed.crlf}\r\n`,
      errors: [ { messageId: 'alignAttribute' } ]
    },
    {
      name: 'every start tag in a template',
      code: lines(
        '<div  a></div>',
        '<ng-template  #t></ng-template>',
        '<p *ngIf="x"  class="y"></p>',
        '@if (x) {',
        '  <span  a><ng-content  select="b"/></span>',
        '}'
      ),
      output: lines(
        '<div a></div>',
        '<ng-template #t></ng-template>',
        '<p *ngIf="x"\n   class="y"></p>',
        '@if (x) {',
        '  <span a><ng-content select="b" /></span>',
        '}'
      ),
      errors: [
        { messageId: 'firstAttribute', line: 1 },
        { messageId: 'firstAttribute', line: 2 },
        { messageId: 'alignAttribute', line: 3 },
        { messageId: 'firstAttribute', line: 5, column: 10 },
        { messageId: 'firstAttribute', line: 5, column: 25 },
        { messageId: 'closing', line: 5, column: 35 }
      ]
    }
  ]
});
