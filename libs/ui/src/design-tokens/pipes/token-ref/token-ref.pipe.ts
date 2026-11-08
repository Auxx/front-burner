import { Pipe, PipeTransform } from '@angular/core';

/** A token's CSS reference: `'text-default'` becomes `var(--ui-text-default)`. */
@Pipe({ name: 'tokenRef' })
export class TokenRefPipe implements PipeTransform {
  transform(token: string): string {
    return tokenRef(token);
  }
}

export function tokenRef(token: string): string {
  return `var(--ui-${token})`;
}
