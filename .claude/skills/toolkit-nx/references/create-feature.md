# create-feature

Read this after running the feature generator (command and dry-run output are in
[SKILL.md](../SKILL.md#commands)). The generator creates an empty
`<feature>.routes.ts` file. In applications, it also wires the feature into the
application routes automatically - there is no need to add the route manually.
In libraries, see [Features in libraries](#features-in-libraries).

## Routing in applications

The generator adds a lazy-loaded route to the routes array in
`<sourceRoot>/app/app.routes.ts` (the first variable of type `Route[]` or
`Routes`):

```ts
{ path: '<feature-name>', loadChildren: () => import('../<feature-name>/<feature-name>.routes').then(m => m.routes) }
```

- The route is inserted before the wildcard route (`path: '**'`), if there is
  one; otherwise it is appended.
- Pages created with the page generator are registered in `<feature>.routes.ts`,
  so they are reachable at `/<feature-name>/<page-name>`.
- If `app.routes.ts` does not exist (always the case in a library), or has no
  routes array, the generator still creates the feature and leaves routing
  unchanged. It prints `"<path>" does not exist. Add the routes of feature
  "<feature-name>" manually.` or `No routes array of type Route[] or Routes
  found in "<path>". …`. In an application, wire the feature into the routes the
  project uses yourself, following the snippet above, and mention it in your
  report. In a library, this warning is expected - follow
  [Features in libraries](#features-in-libraries).
- Change the generated route only if the task needs something else (for example,
  a different URL, a guard, or a non-lazy route).

## Features in libraries

A library feature has the same layout as an application feature, and pages are
registered in its `<feature>.routes.ts` in the same way. Nothing outside the
library knows about it until you expose it:

1. Export the feature routes, and any artefact other projects need, from the
   library's entry point (usually `<sourceRoot>/index.ts`, the file the
   `tsconfig.base.json` path alias points to). Rename `routes` on export, since
   every feature exports a variable with that name:

   ```ts
   export { routes as ordersRoutes } from './orders/orders.routes';
   ```

2. If the task asks for the feature to be reachable in an application, add a
   lazy-loaded route to that application's `app.routes.ts`, importing through
   the library alias, not a relative path:

   ```ts
   { path: 'orders', loadChildren: () => import('@my-org/orders-lib').then(m => m.ordersRoutes) }
   ```

3. Libraries with a `lint` target often check that every imported package is
   listed in the library's own `package.json` (rule `@nx/dependency-checks`).
   Generated code imports packages the library may not have used before: for
   example `@angular/core` (components, pages, services), `@angular/router`
   (feature routes) and `@jsverse/transloco` (`--translations`). If lint reports
   packages "missing from peerDependencies", add exactly those packages to
   `peerDependencies`, with a range based on the version in the workspace
   `package.json` (for example `^22.2.3` for `22.2.3`).
