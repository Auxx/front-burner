// Tables live here (A-4.3). They arrive with the features that need them, and
// `nx run server-core-database:db-generate` turns them into migrations.
export * from './encrypted-columns';
export * from './instance-state';
export * from './jobs';
export * from './known-hosts';
export * from './login-audit';
export * from './repositories';
export * from './saved-credentials';
export * from './sessions';
export * from './system-settings';
export * from './users';
