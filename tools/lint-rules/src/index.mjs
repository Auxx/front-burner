import attributeLayout from './rules/attribute-layout.mjs';
import noRawText from './rules/no-raw-text.mjs';
import noTemplateCalls from './rules/no-template-calls.mjs';

/** The workspace's local ESLint plugin; its rules are referenced as `front-burner/<rule>`. */
const plugin = {
  meta: { name: 'front-burner' },
  rules: {
    'attribute-layout': attributeLayout,
    'no-raw-text': noRawText,
    'no-template-calls': noTemplateCalls
  }
};

export default plugin;
