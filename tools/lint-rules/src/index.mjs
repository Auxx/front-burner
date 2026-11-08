import attributeLayout from './rules/attribute-layout.mjs';
import noTemplateCalls from './rules/no-template-calls.mjs';

/** The workspace's local ESLint plugin; its rules are referenced as `front-burner/<rule>`. */
const plugin = {
  meta: { name: 'front-burner' },
  rules: {
    'attribute-layout': attributeLayout,
    'no-template-calls': noTemplateCalls
  }
};

export default plugin;
