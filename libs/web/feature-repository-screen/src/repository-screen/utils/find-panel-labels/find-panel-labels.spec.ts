import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';

import { translocoTesting } from '../../../testing/transloco-testing';
import { findPanelLabels } from './find-panel-labels';

const KEY = 'web-feature-repository-screen.EditorPaneComponent.findPanel';

describe('findPanelLabels', () => {
  it('translates the find panel\'s texts, with numbers in the active language', () => {
    TestBed.configureTestingModule({
      imports: [
        translocoTesting({
          [`${KEY}.find`]: 'Find',
          [`${KEY}.count`]: '{{ current }} of {{ total }}',
          [`${KEY}.found`]: '{{ total }} found',
          [`${KEY}.more`]: '{{ total }}+'
        })
      ]
    });

    const labels = findPanelLabels(TestBed.inject(TranslocoService));

    expect(labels.find).toBe('Find');
    expect(labels.count(2, 1500, false)).toBe('2 of 1,500');
    expect(labels.count(0, 1000, true)).toBe('1,000+ found');
  });
});
