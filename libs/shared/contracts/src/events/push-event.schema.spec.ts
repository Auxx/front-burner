import { PushEventSchema } from './push-event.schema';

describe('PushEventSchema', () => {
  it('parses each event type', () => {
    const events = [
      { type: 'repository.status', repositoryId: 1, status: 'error', error: 'clone-failed' },
      { type: 'job.progress', jobId: 2, percent: 40 },
      { type: 'job.finished', jobId: 2, outcome: 'done' }
    ];
    for (const event of events) {
      expect(PushEventSchema.parse(event)).toEqual(event);
    }
  });

  it('refuses an unknown event type', () => {
    expect(PushEventSchema.safeParse({ type: 'repository.deleted', repositoryId: 1 }).success).toBe(false);
  });

  it('refuses a percentage above 100', () => {
    expect(PushEventSchema.safeParse({ type: 'job.progress', jobId: 2, percent: 101 }).success).toBe(false);
  });
});
