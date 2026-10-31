import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CentredIslandComponent } from './centred-island.component';

@Component({
  imports: [ CentredIslandComponent ],
  template: `
    <ui-centred-island [width]="width()">
      <h1>Log in</h1>
      <div uiCentredIslandAfter class="banner">A banner</div>
    </ui-centred-island>
  `
})
class HostComponent {
  readonly width = input('28rem');
}

describe('CentredIslandComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent ] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    root = fixture.nativeElement;
  });

  it('renders projected content inside a ui-island', () => {
    expect(root.querySelector('ui-island h1')?.textContent).toBe('Log in');
  });

  it('renders the after content below the island, outside it', () => {
    const banner = root.querySelector('.banner') as HTMLElement;
    const island = root.querySelector('ui-island') as HTMLElement;
    expect(island.contains(banner)).toBe(false);
    expect(island.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sets the maximum inline size of the island from width', async () => {
    const island = root.querySelector('ui-island') as HTMLElement;
    expect(island.style.maxInlineSize).toBe('28rem');
    fixture.componentRef.setInput('width', '24rem');
    await fixture.whenStable();
    expect(island.style.maxInlineSize).toBe('24rem');
  });
});
