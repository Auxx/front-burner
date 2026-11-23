import { join } from 'node:path';
import { nodeConfig } from '../../../vitest.shared.mjs';

// The build scripts' tests run in Node, apart from the web client's own tests,
// which the Angular unit-test builder runs from src/ only. The web project's
// `test` target depends on `test-scripts`, which runs these.
export default nodeConfig(join(import.meta.dirname, '..'), { include: [ 'scripts/**/*.spec.mjs' ] });
