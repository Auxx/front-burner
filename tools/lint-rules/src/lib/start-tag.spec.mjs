import { describe, expect, it } from 'vitest';
import { scanStartTag } from './start-tag.mjs';

const textsOf = tag => tag.attributes.map(attribute => attribute.text);

describe('scanStartTag', () => {
  it('reads a tag without attributes', () => {
    expect(scanStartTag('<div></div>', 0)).toEqual({
      name: 'div',
      nameEnd: 4,
      attributes: [],
      closing: '>',
      closingStart: 4,
      end: 5
    });
  });

  it('reads a self-closing tag', () => {
    const tag = scanStartTag('<br />', 0);
    expect(tag).toMatchObject({ name: 'br', closing: '/>', closingStart: 4, end: 6 });
    expect(tag.attributes).toEqual([]);
  });

  it('starts at the offset and gives absolute offsets', () => {
    const text = 'x <a href="y">';
    const tag = scanStartTag(text, 2);
    expect(tag).toMatchObject({ name: 'a', nameEnd: 4, closingStart: 13, end: 14 });
    expect(tag.attributes).toEqual([ { text: 'href="y"', start: 5, end: 13, bound: false } ]);
  });

  it('reads every kind of attribute, with quotes hiding > and spaces', () => {
    const tag = scanStartTag('<a href="a/b" [x]="a > b" (y)=\'f()\' disabled #ref let-item>', 0);
    expect(textsOf(tag)).toEqual([ 'href="a/b"', '[x]="a > b"', '(y)=\'f()\'', 'disabled', '#ref', 'let-item' ]);
    expect(tag.attributes.map(attribute => attribute.bound)).toEqual([ false, true, true, false, false, false ]);
    expect(tag.closing).toBe('>');
  });

  it('reads a value spanning lines as one attribute', () => {
    const tag = scanStartTag('<div [x]="{\n  a: 1\n}"\n     class="y">', 0);
    expect(textsOf(tag)).toEqual([ '[x]="{\n  a: 1\n}"', 'class="y"' ]);
  });

  it('marks structural directives, animations and two-way bindings as bound', () => {
    const tag = scanStartTag('<div *transloco="let t" @fade [@fade]="s" [(z)]="v">', 0);
    expect(textsOf(tag)).toEqual([ '*transloco="let t"', '@fade', '[@fade]="s"', '[(z)]="v"' ]);
    expect(tag.attributes.every(attribute => attribute.bound)).toBe(true);
  });

  it('ends an attribute at /> and keeps a slash inside an unquoted value', () => {
    const tag = scanStartTag('<ui-icon name=a/b/>', 0);
    expect(textsOf(tag)).toEqual([ 'name=a/b' ]);
    expect(tag).toMatchObject({ closing: '/>', closingStart: 17, end: 19 });
  });
});
