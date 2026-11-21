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

  it('keeps only the latest mark of each name', () => {
    performance.mark('other');
    markPerformance('fb:tree-folder-shown', { folder: '' });
    markPerformance('fb:preview-updated');
    markPerformance('fb:tree-folder-shown', { folder: 'docs' });

    const folders = performance.getEntriesByName('fb:tree-folder-shown', 'mark') as PerformanceMark[];
    expect(folders.map(mark => mark.detail)).toEqual([ { folder: 'docs' } ]);
    expect(performance.getEntriesByName('fb:preview-updated', 'mark')).toHaveLength(1);
    expect(performance.getEntriesByName('other', 'mark')).toHaveLength(1);
  });

  it('does nothing without the User Timing API', () => {
    vi.stubGlobal('performance', { now: () => 0 });

    expect(() => markPerformance('fb:app-ready')).not.toThrow();
  });
});
