import { TabList } from '@angular/aria/tabs';
import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';

/**
 * The row of tabs that switches the panels of a `uiTabGroup`, built on Angular
 * Aria's Tabs: one tab stop, arrow keys between the tabs, and the selection
 * follows focus. Horizontal only.
 *
 * `[(selected)]` is the value of the selected tab. When it matches no enabled
 * tab, the first enabled tab is opened.
 */
@Component({
  selector: 'ui-tab-strip',
  templateUrl: './tab-strip.component.html',
  styleUrl: './tab-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [
    { directive: TabList, inputs: [ 'selectedTab: selected' ], outputs: [ 'selectedTabChange: selectedChange' ] }
  ],
  host: {
    '[attr.aria-label]': 'label()'
  }
})
export class TabStripComponent {
  readonly label = input.required<string>();

  private readonly tabList = inject(TabList);

  constructor() {
    effect(() => {
      const tabs = this.tabList._collection.orderedItems();
      const selected = this.tabList.findTab(this.tabList.selectedTab());
      if (tabs.length > 0 && (!selected || selected.disabled())) {
        tabs.find(tab => !tab.disabled())?.open();
      }
    });
  }
}
