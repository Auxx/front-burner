import type { ShikiTransformer } from 'shiki/core';

/** Shiki's highlighting as classes, and the CSS that colours them (D-7.5). */
export interface ShikiClasses {
  /** Replaces every token's colours with a class `sk-<n>`, and Shiki's own markup with none. */
  transformer: ShikiTransformer;
  /** The CSS rules of the classes created since the last call. */
  takeCss: () => string;
}

/**
 * One class per pair of light and dark colours, so that neither sanitising
 * step nor the content security policy has to allow `style` (D-7.5, A-8.12).
 * The classes live as long as the worker; a cached fragment keeps using its
 * classes.
 */
export function createShikiClasses(): ShikiClasses {
  const classes = new Map<string, string>();
  let css = '';

  const classOf = (light: string, dark: string): string => {
    const pair = `${light} ${dark}`;
    let name = classes.get(pair);
    if (!name) {
      name = `sk-${classes.size + 1}`;
      classes.set(pair, name);
      css += `.${name} { color: light-dark(${light}, ${dark}) }\n`;
    }
    return name;
  };

  return {
    transformer: {
      name: 'front-burner:classes',
      pre(node) {
        node.properties = {};
      },
      code(node) {
        node.properties = { className: [ `language-${this.options.lang}` ] };
      },
      line(node) {
        node.properties = {};
      },
      span(node, _line, _column, _lineElement, token) {
        const light = colour(token.htmlStyle?.['--shiki-light']);
        const dark = colour(token.htmlStyle?.['--shiki-dark']);
        node.properties = light && dark ? { className: [ classOf(light, dark) ] } : {};
      }
    },
    takeCss: () => {
      const taken = css;
      css = '';
      return taken;
    }
  };
}

/** A theme's colour, which goes into CSS: only hex colours are taken. */
function colour(value: string | undefined): string | undefined {
  return value && /^#[\da-f]{3,8}$/i.test(value) ? value.toLowerCase() : undefined;
}
