import type { FindPanelLabels } from '@front-burner/web-code-editor';
import type { TranslocoService } from '@jsverse/transloco';

/** The find panel's texts (ED-11), in the language of the moment. Shared by every editor of the screen. */
export function findPanelLabels(transloco: TranslocoService): FindPanelLabels {
  const t = (key: string, params?: Record<string, string>) =>
    transloco.translate(`web-feature-repository-screen.EditorPaneComponent.findPanel.${key}`, params);
  const numbers = new Intl.NumberFormat(transloco.getActiveLang());
  return {
    find: t('find'),
    replace: t('replace'),
    toggleReplace: t('toggleReplace'),
    matchCase: t('matchCase'),
    wholeWord: t('wholeWord'),
    regexp: t('regexp'),
    previous: t('previous'),
    next: t('next'),
    close: t('close'),
    replaceOne: t('replaceOne'),
    replaceAll: t('replaceAll'),
    noResults: t('noResults'),
    invalid: t('invalid'),
    count: (current, total, more) => {
      const all = more ? t('more', { total: numbers.format(total) }) : numbers.format(total);
      return current > 0 ? t('count', { current: numbers.format(current), total: all }) : t('found', { total: all });
    }
  };
}
