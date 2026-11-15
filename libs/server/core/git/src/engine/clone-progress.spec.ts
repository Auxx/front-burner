import { CloneProgressParser, withoutProgress } from './clone-progress';

describe('CloneProgressParser', () => {
  let reported: number[];
  let parser: CloneProgressParser;

  beforeEach(() => {
    reported = [];
    parser = new CloneProgressParser(percent => reported.push(percent));
  });

  it('counts receiving objects as the first 80 % and resolving deltas as the rest', () => {
    parser.push('Cloning into \'/tmp/clone-x\'...\n');
    parser.push('remote: Counting objects: 100% (10/10), done.\n');
    parser.push('Receiving objects:  50% (5/10)\rReceiving objects: 100% (10/10), done.\n');
    parser.push('Resolving deltas:  50% (2/4)\rResolving deltas: 100% (4/4), done.\n');

    expect(reported).toEqual([ 40, 80, 90, 100 ]);
  });

  it('reads a line split between chunks', () => {
    parser.push('Receiving objects:  2');
    parser.push('5% (1/4)\r');

    expect(reported).toEqual([ 20 ]);
  });

  it('never goes back, and reports each value once', () => {
    parser.push('Receiving objects:  50% (5/10)\rReceiving objects:  50% (5/10)\r');
    parser.push('Receiving objects:  10% (1/10)\r');

    expect(reported).toEqual([ 40 ]);
  });

  it('ignores the remote\'s own phases and other lines', () => {
    parser.push('remote: Compressing objects:  50% (3/6)\rwarning: something\n');

    expect(reported).toEqual([]);
  });
});

describe('withoutProgress', () => {
  it('keeps git\'s messages and drops its progress lines', () => {
    const stderr = [
      'Cloning into \'/tmp/clone-x\'...',
      'remote: Enumerating objects: 5, done.',
      'remote: Counting objects:  50% (1/2)\rremote: Counting objects: 100% (2/2), done.',
      'Receiving objects:  40% (2/5)\rReceiving objects: 100% (5/5), done.',
      'fatal: early EOF',
      ''
    ].join('\n');

    expect(withoutProgress(stderr)).toBe('Cloning into \'/tmp/clone-x\'...\nfatal: early EOF\n');
  });

  it('leaves stderr without progress as it is', () => {
    expect(withoutProgress('fatal: repository not found\n')).toBe('fatal: repository not found\n');
  });
});
