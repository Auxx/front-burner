# eslint-rules

The workspace's local ESLint plugin, `front-burner`, which holds the custom lint
rules that no published plugin offers, such as `front-burner/attribute-layout`
for the layout of attributes in Angular templates. It is plain JavaScript with
no build step, and it is not published: a project opts in by importing the
plugin from `src/index.mjs` in its `eslint.config.mjs`, registering it under the
name `front-burner` and turning its rules on.
