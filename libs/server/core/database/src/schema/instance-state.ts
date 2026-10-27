import type { OnboardingState } from '@front-burner/shared-contracts';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// drizzle-kit loads this file without the workspace's path aliases, so only a
// type may come from the contracts; a test checks that the lists agree.
export const ONBOARDING_STATE_VALUES = [
  'required',
  'oidc-pending',
  'completed'
] as const satisfies readonly OnboardingState[];

/** The instance's one row of state (A-4.4); the pending administrator email comes with OIDC. */
export const instanceState = sqliteTable(
  'instance_state',
  {
    id: integer('id').primaryKey(),
    onboardingState: text('onboarding_state', { enum: ONBOARDING_STATE_VALUES }).notNull(),
    /** A known plaintext encrypted with the current key (A-4.10); set at the first start. */
    encryptionCheck: text('encryption_check')
  },
  table => [ check('instance_state_single_row', sql`${table.id} = 1`) ]
);
