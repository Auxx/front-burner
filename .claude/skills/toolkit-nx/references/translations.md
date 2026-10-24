# Translations support

The component and page generators accept `--translations=true`. It adds
boilerplate for the [Transloco](https://jsverse.gitbook.io/transloco) library:

- the template is wrapped in `<ng-container *transloco="let t; prefix:
  '<projectName>.<ClassName>'">`;
- the class imports `TranslocoDirective` from `@jsverse/transloco`;
- the spec imports `TranslocoTestingModule.forRoot(...)`, because `TestBed` does
  not use the application's Transloco configuration. Keep it when editing the
  spec; add translations to its `langs` if a test checks translated text.

`--translations` defaults to `false`.

## Requirements

- `@jsverse/transloco` must be listed in `dependencies` or `devDependencies` of
  the workspace `package.json`. If it is not, the generator fails with
  `Dependency "@jsverse/transloco" is not installed.` and creates no files.
- Transloco must be configured in the application, for example with
  `provideTransloco(...)` in `app.config.ts` and a loader. For an artefact in a
  library, check the applications that use the library. The generator does not
  configure Transloco.

## If Transloco is missing

Do NOT install or configure Transloco on your own. Either generate the artefact
without `--translations`, or ask the user whether Transloco should be added to
the workspace.
