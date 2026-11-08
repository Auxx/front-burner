import type { PushEvent } from '@front-burner/shared-contracts';
import { EventsHub, EventStream } from './events-hub';

const event: PushEvent = { type: 'job.progress', jobId: 1, percent: 50 };

describe('EventsHub', () => {
  let hub: EventsHub;

  const stream = (userId: number, sessionId: string, repositoryId: number | null = null) => {
    const opened = { userId, sessionId, repositoryId, send: vi.fn(), close: vi.fn() } satisfies EventStream;
    const remove = hub.open(opened);
    return { ...opened, remove };
  };

  beforeEach(() => {
    hub = new EventsHub();
  });

  it('delivers only to the user\'s streams', () => {
    const alice = [ stream(1, 'a1'), stream(1, 'a2') ];
    const bob = stream(2, 'b1');

    hub.publish(1, event);

    for (const tab of alice) {
      expect(tab.send).toHaveBeenCalledWith(event);
    }
    expect(bob.send).not.toHaveBeenCalled();
  });

  it('delivers to one session\'s streams only', () => {
    const tabs = [ stream(1, 'a1'), stream(1, 'a1') ];
    const otherSession = stream(1, 'a2');
    const bob = stream(2, 'b1');

    hub.publishToSession('a1', event);

    for (const tab of tabs) {
      expect(tab.send).toHaveBeenCalledWith(event);
    }
    expect(otherSession.send).not.toHaveBeenCalled();
    expect(bob.send).not.toHaveBeenCalled();
  });

  it('stops delivering to a removed stream', () => {
    const tab = stream(1, 'a1');
    tab.remove();

    hub.publish(1, event);

    expect(tab.send).not.toHaveBeenCalled();
  });

  it('lists a stream that views a repository', () => {
    stream(1, 'a1', 7);
    stream(2, 'b1', 8);

    expect(hub.viewers()).toEqual([
      { userId: 1, sessionId: 'a1', repositoryId: 7 },
      { userId: 2, sessionId: 'b1', repositoryId: 8 }
    ]);
  });

  it('leaves out a stream that views none', () => {
    stream(1, 'a1');
    stream(1, 'a2', 7);

    expect(hub.viewers()).toEqual([ { userId: 1, sessionId: 'a2', repositoryId: 7 } ]);
  });

  it('forgets a stream that closed', () => {
    const tab = stream(1, 'a1', 7);
    stream(1, 'a2', 8);

    tab.remove();
    expect(hub.viewers()).toEqual([ { userId: 1, sessionId: 'a2', repositoryId: 8 } ]);

    hub.closeSession('a2');
    expect(hub.viewers()).toEqual([]);
  });

  it('closes only the streams of a session', () => {
    const closed = stream(1, 'a1');
    const kept = stream(1, 'a2');

    hub.closeSession('a1');
    hub.publish(1, event);

    expect(closed.close).toHaveBeenCalledOnce();
    expect(closed.send).not.toHaveBeenCalled();
    expect(kept.close).not.toHaveBeenCalled();
    expect(kept.send).toHaveBeenCalledWith(event);
  });

  it('closes every stream on shutdown', () => {
    const tabs = [ stream(1, 'a1'), stream(2, 'b1') ];

    hub.beforeApplicationShutdown();

    for (const tab of tabs) {
      expect(tab.close).toHaveBeenCalledOnce();
    }
  });

  it('closes a stream opened after shutdown began', () => {
    hub.beforeApplicationShutdown();

    const late = stream(1, 'a1');
    hub.publish(1, event);

    expect(late.close).toHaveBeenCalledOnce();
    expect(late.send).not.toHaveBeenCalled();
  });
});
