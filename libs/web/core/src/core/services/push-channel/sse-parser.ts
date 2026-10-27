/** What the parser carries from one chunk to the next. */
export interface SseParserState {
  /** The unfinished last line. */
  readonly line: string;
  /** The `event` field of the event being read; empty for none. */
  readonly type: string;
  /** Its `data` lines. */
  readonly data: readonly string[];
  /** The last chunk ended with `\r`, so a `\n` that starts the next one belongs to it. */
  readonly afterCr: boolean;
}

export interface SseEvent {
  type: string;
  data: string;
}

export const INITIAL_SSE_STATE: SseParserState = { line: '', type: '', data: [], afterCr: false };

/**
 * Reads Server-Sent Events from a stream that arrives in chunks, as the
 * HTML standard's event stream format says: lines end with `\r\n`, `\n` or
 * `\r`, lines starting with `:` are comments, a blank line ends an event.
 * Fields other than `event` and `data` are ignored, as are events without data.
 */
export function parseSse(chunk: string, state: SseParserState): { events: SseEvent[]; state: SseParserState; } {
  const events: SseEvent[] = [];
  let { line, type, afterCr } = state;
  let data = [ ...state.data ];

  const endLine = () => {
    if (line === '') {
      if (data.length > 0) {
        events.push({ type: type === '' ? 'message' : type, data: data.join('\n') });
      }
      type = '';
      data = [];
    } else if (!line.startsWith(':')) {
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      if (field === 'event') {
        type = value;
      } else if (field === 'data') {
        data.push(value);
      }
    }
    line = '';
  };

  for (const char of chunk) {
    if (afterCr) {
      afterCr = false;
      if (char === '\n') {
        continue;
      }
    }
    if (char === '\r') {
      endLine();
      afterCr = true;
    } else if (char === '\n') {
      endLine();
    } else {
      line += char;
    }
  }
  return { events, state: { line, type, data, afterCr } };
}
