import { INITIAL_SSE_STATE, parseSse, SseEvent, SseParserState } from './sse-parser';

/** Feeds the chunks one after another and collects every event. */
function parseAll(chunks: string[]): { events: SseEvent[]; state: SseParserState; } {
  let state = INITIAL_SSE_STATE;
  const events: SseEvent[] = [];
  for (const chunk of chunks) {
    const result = parseSse(chunk, state);
    events.push(...result.events);
    state = result.state;
  }
  return { events, state };
}

describe('parseSse', () => {
  it('reads an event', () => {
    expect(parseAll([ 'event: job.progress\ndata: {"percent":5}\n\n' ]).events).toEqual([
      { type: 'job.progress', data: '{"percent":5}' }
    ]);
  });

  it('joins an event split across chunks', () => {
    const { events } = parseAll([ 'event: job.fin', 'ished\nda', 'ta: {"jobId":1}\n', '\nevent: a\ndata: 1\n\n' ]);
    expect(events).toEqual([ { type: 'job.finished', data: '{"jobId":1}' }, { type: 'a', data: '1' } ]);
  });

  it('waits for the blank line', () => {
    const { events, state } = parseAll([ 'event: a\ndata: 1\n' ]);
    expect(events).toEqual([]);
    expect(parseSse('\n', state).events).toEqual([ { type: 'a', data: '1' } ]);
  });

  it('skips comments', () => {
    expect(parseAll([ ': keep-alive\n\n', ': keep-alive\n\nevent: a\n: inside\ndata: 1\n\n' ]).events).toEqual([
      { type: 'a', data: '1' }
    ]);
  });

  it('accepts CRLF', () => {
    expect(parseAll([ 'event: a\r\ndata: 1\r', '\n\r\nevent: b\rdata: 2\r\r' ]).events).toEqual([
      { type: 'a', data: '1' },
      { type: 'b', data: '2' }
    ]);
  });

  it('joins data lines and defaults the type to message', () => {
    expect(parseAll([ 'data: one\ndata:two\nid: 4\n\n' ]).events).toEqual([ { type: 'message', data: 'one\ntwo' } ]);
  });
});
