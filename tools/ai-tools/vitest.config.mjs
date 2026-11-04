import { nodeConfig } from '../../vitest.shared.mjs';

export default nodeConfig(import.meta.dirname, { include: [ 'src/**/*.spec.mjs' ] });
