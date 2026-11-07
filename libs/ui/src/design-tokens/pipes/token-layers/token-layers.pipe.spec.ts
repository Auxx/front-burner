import { TokenLayersPipe } from './token-layers.pipe';

describe('TokenLayersPipe', () => {
  const pipe = new TokenLayersPipe();

  it('paints a single layer as its colour', () => {
    expect(pipe.transform([ 'surface-canvas' ])).toBe('var(--ui-surface-canvas)');
  });

  it('stacks the later layers over the first', () => {
    expect(pipe.transform([ 'surface-canvas', 'surface-hover', 'selected-active' ])).toBe(
      'linear-gradient(var(--ui-selected-active), var(--ui-selected-active)), '
        + 'linear-gradient(var(--ui-surface-hover), var(--ui-surface-hover)), var(--ui-surface-canvas)'
    );
  });

  it('leaves the layers it is given unchanged', () => {
    const layers = [ 'a', 'b', 'c' ];

    pipe.transform(layers);

    expect(layers).toEqual([ 'a', 'b', 'c' ]);
  });
});
