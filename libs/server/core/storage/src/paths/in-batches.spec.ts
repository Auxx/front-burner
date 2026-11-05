import { inBatches } from './in-batches';

describe('inBatches', () => {
  it('runs the task for every item', async () => {
    const seen: number[] = [];

    await inBatches([ 1, 2, 3, 4, 5 ], async item => {
      seen.push(item);
    }, 2);

    expect(seen).toEqual([ 1, 2, 3, 4, 5 ]);
  });

  it('runs no more than a batch at once', async () => {
    let running = 0;
    let most = 0;

    await inBatches(Array.from({ length: 100 }, (_, index) => index), async () => {
      running++;
      most = Math.max(most, running);
      await new Promise(resolve => setTimeout(resolve));
      running--;
    });

    expect(most).toBe(32);
  });

  it('starts no further batch after a failure', async () => {
    const seen: number[] = [];

    await expect(inBatches([ 1, 2, 3 ], async item => {
      seen.push(item);
      throw new Error('failed');
    }, 1)).rejects.toThrow('failed');

    expect(seen).toEqual([ 1 ]);
  });
});
