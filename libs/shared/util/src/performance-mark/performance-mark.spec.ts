import { markPerformance } from './performance-mark';

describe('markPerformance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    performance.clearMarks();
  });

  it('sets a mark with its detail', () => {
    markPerformance('fb:tree-folder-shown', { folder: 'docs' });
    markPerformance('fb:editor-ready');

    const [ folder ] = performance.getEntriesByName('fb:tree-folder-shown', 'mark') as PerformanceMark[];
    expect(folder.detail).toEqual({ folder: 'docs' });
    expect(performance.getEntriesByName('fb:editor-ready', 'mark')).toHaveLength(1);
  });

  it('does nothing without the User Timing API', () => {
    vi.stubGlobal('performance', { now: () => 0 });

    expect(() => markPerformance('fb:app-ready')).not.toThrow();
  });
});
