import { Pipe, PipeTransform } from '@angular/core';

import { tokenRef } from '../token-ref/token-ref.pipe';

/** A CSS `background` that stacks the layers' tokens, the first at the bottom. */
@Pipe({ name: 'tokenLayers' })
export class TokenLayersPipe implements PipeTransform {
  transform(layers: readonly string[]): string {
    const [ bottom, ...overlays ] = layers;
    const images = overlays.reverse().map(layer => `linear-gradient(${tokenRef(layer)}, ${tokenRef(layer)})`);
    return [ ...images, tokenRef(bottom) ].join(', ');
  }
}
