import { SessionLifecycle } from './session-lifecycle';

describe('SessionLifecycle', () => {
  it('tells every listener about a revoked session', () => {
    const lifecycle = new SessionLifecycle();
    const first: string[] = [];
    const second: string[] = [];
    lifecycle.revoked.subscribe(id => first.push(id));
    lifecycle.revoked.subscribe(id => second.push(id));

    lifecycle.notifyRevoked('session-1');
    lifecycle.notifyRevoked('session-2');

    expect(first).toEqual([ 'session-1', 'session-2' ]);
    expect(second).toEqual([ 'session-1', 'session-2' ]);
  });

  it('does not replay earlier revocations to a late listener', () => {
    const lifecycle = new SessionLifecycle();
    lifecycle.notifyRevoked('session-1');
    const seen: string[] = [];
    lifecycle.revoked.subscribe(id => seen.push(id));
    expect(seen).toEqual([]);
  });
});
