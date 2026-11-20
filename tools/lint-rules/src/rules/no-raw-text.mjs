/** A letter of any script: text with one is meant to be read, so it must be translated. */
const LETTER = /\p{L}/u;

/** Attributes, static or bound, whose value a person reads or hears (NF-14.2). */
const READ_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title'
]);

/** Elements whose text is literal computer text, the same in every language. */
const LITERAL_ELEMENTS = new Set([ 'code', 'kbd', 'samp' ]);

/** Whether `node` is inside a `<code>`, `<kbd>` or `<samp>` element. */
function insideLiteral(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'Element' && LITERAL_ELEMENTS.has(current.name)) {
      return true;
    }
  }
  return false;
}

/**
 * The fixed text that an expression shows as it is: the text around an
 * interpolation, string literals that are its value (both branches of a
 * conditional, either side of `??`, `||` and `+`, a piped value) and the
 * text of a template literal. What a call receives, such as the key of
 * `t('key')`, and what a condition compares are never shown, so they are
 * not collected.
 */
function shownText(ast) {
  if (!ast || typeof ast !== 'object') {
    return [];
  }
  switch (ast.type) {
    case 'ASTWithSource':
    case 'ParenthesizedExpression':
      return shownText(ast.ast ?? ast.expression);
    case 'Interpolation':
      return [ ...ast.strings, ...ast.expressions.flatMap(shownText) ];
    case 'LiteralPrimitive':
      return typeof ast.value === 'string' ? [ ast.value ] : [];
    case 'Conditional':
      return [ ...shownText(ast.trueExp), ...shownText(ast.falseExp) ];
    case 'Binary':
      return [ '??', '||', '+' ].includes(ast.operation) ? [ ...shownText(ast.left), ...shownText(ast.right) ] : [];
    case 'BindingPipe':
      return shownText(ast.exp);
    case 'TemplateLiteral':
      return [ ...ast.elements.map(element => element.text), ...ast.expressions.flatMap(shownText) ];
    default:
      return [];
  }
}

const hasWords = strings => strings.some(string => LETTER.test(string));

/**
 * `front-burner/no-raw-text`: a template shows no text that does not go
 * through Transloco (NF-14.2). It reports text with a letter between tags,
 * around an interpolation or as a string an interpolation shows (`{{ x ?
 * 'Open' : t('closed') }}`), and the same in an attribute that is read out,
 * static or bound: `aria-label="Close"`, `title="Delete {{ name() }}"`,
 * `[attr.aria-label]="'Close'"`. Punctuation and symbols alone, such as `·` or
 * `/`, are not words and pass, and so is the text of `<code>`, `<kbd>` and
 * `<samp>`, such as an example URL or a variable's name. Strings that a call
 * receives, such as translation keys, and strings of any other binding, such
 * as `[variant]="'primary'"`, are not shown as they are, so they pass.
 */
export default {
  meta: {
    type: 'problem',
    schema: [],
    docs: { description: 'Show text in templates only through Transloco (NF-14.2).' },
    messages: {
      text: 'Text in a template must go through Transloco (NF-14.2): use t(\'…\') with a key in i18n/en.json.',
      attribute:
        'The "{{ name }}" attribute is read by people, so it must go through Transloco (NF-14.2): bind it to t(\'…\').'
    }
  },

  create(context) {
    const readOut = name => READ_ATTRIBUTES.has(name.toLowerCase());
    return {
      Text(node) {
        if (LETTER.test(node.value) && !insideLiteral(node)) {
          context.report({ node, messageId: 'text' });
        }
      },
      BoundText(node) {
        if (hasWords(shownText(node.value)) && !insideLiteral(node)) {
          context.report({ node, messageId: 'text' });
        }
      },
      TextAttribute(node) {
        if (readOut(node.name) && LETTER.test(node.value)) {
          context.report({ node, messageId: 'attribute', data: { name: node.name } });
        }
      },
      BoundAttribute(node) {
        if (readOut(node.name) && hasWords(shownText(node.value))) {
          context.report({ node, messageId: 'attribute', data: { name: node.name } });
        }
      }
    };
  }
};
