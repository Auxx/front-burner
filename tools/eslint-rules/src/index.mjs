import attributeLayout from './rules/attribute-layout.mjs';

/** The workspace's local ESLint plugin; its rules are referenced as `front-burner/<rule>`. */
const plugin = {
  meta: { name: 'front-burner' },
  rules: {
    'attribute-layout': attributeLayout
  }
};

export default plugin;
