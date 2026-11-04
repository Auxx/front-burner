import { defineConfig } from 'vitest/config';
import { sharedTestOptions } from './vitest.shared.mjs';

/**
 * The shared unit-test settings for the projects that the Angular unit-test
 * builder runs (`@angular/build:unit-test`, `@nx/angular:unit-test`): their
 * `runnerConfig: true` in nx.json makes the builder look for this file in the
 * project and then here. The builder sets the files, the environment and the
 * watch mode itself, so only the test options go here.
 */
export default defineConfig({ test: sharedTestOptions });
