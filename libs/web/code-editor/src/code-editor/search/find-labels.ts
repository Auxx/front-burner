import { Facet } from '@codemirror/state';

/** The texts of the find panel (ED-11): accessible names, placeholders and the counter. */
export interface FindPanelLabels {
  find: string;
  replace: string;
  toggleReplace: string;
  matchCase: string;
  wholeWord: string;
  regexp: string;
  previous: string;
  next: string;
  close: string;
  replaceOne: string;
  replaceAll: string;
  noResults: string;
  invalid: string;
  /**
   * The counter: the number of the selected match, or 0 when the selection is
   * not on a match, of `total` matches; `more` when counting stopped at `total`.
   */
  count: (current: number, total: number, more: boolean) => string;
}

function englishCount(current: number, total: number, more: boolean): string {
  const all = `${total.toLocaleString('en')}${more ? '+' : ''}`;
  return current > 0 ? `${current.toLocaleString('en')} of ${all}` : `${all} found`;
}

/** English, so that the library works without a translation. */
const ENGLISH: FindPanelLabels = {
  find: 'Find',
  replace: 'Replace',
  toggleReplace: 'Toggle replace',
  matchCase: 'Match case',
  wholeWord: 'Whole word',
  regexp: 'Regular expression',
  previous: 'Previous match',
  next: 'Next match',
  close: 'Close',
  replaceOne: 'Replace match',
  replaceAll: 'Replace all',
  noResults: 'No results',
  invalid: 'Invalid expression',
  count: englishCount
};

/** The find panel's texts; the last value given wins. The library has no Transloco, so the client passes them. */
export const findLabels = Facet.define<FindPanelLabels, FindPanelLabels>({
  combine: values => values.at(-1) ?? ENGLISH
});

/** The URL of the icon sprite (A-10.35) that the find panel's buttons draw from; the last value given wins. */
export const findIconSprite = Facet.define<string, string>({
  combine: values => values.at(-1) ?? 'assets/icons.svg'
});
