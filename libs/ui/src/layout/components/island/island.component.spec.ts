import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IslandComponent } from './island.component';

@Component({
  imports: [ IslandComponent ],
  template: `
    <ui-island heading="Files">
      <button uiIslandHeader type="button">Refresh</button>
      <p>Body text</p>
    </ui-island>
  `
})
class HostComponent {}

describe('IslandComponent', () => {
  let fixture: ComponentFixture<IslandComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ IslandComponent, HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(IslandComponent);
  });

  it('is a region labelled by its heading', async () => {
    fixture.componentRef.setInput('heading', 'Files');
    await fixture.whenStable();

    const host: HTMLElement = fixture.nativeElement;
    const title = host.querySelector('h2') as HTMLElement;
    expect(host.getAttribute('role')).toBe('region');
    expect(host.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.textContent?.trim()).toBe('Files');
  });

  it('uses its label when it has no heading', async () => {
    fixture.componentRef.setInput('label', 'Preview');
    await fixture.whenStable();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('role')).toBe('region');
    expect(host.getAttribute('aria-label')).toBe('Preview');
    expect(host.hasAttribute('aria-labelledby')).toBe(false);
    expect(host.querySelector('h2')).toBeNull();
  });

  it('is not a region without a name', async () => {
    await fixture.whenStable();

    expect(fixture.nativeElement.hasAttribute('role')).toBe(false);
  });

  it('gives each island its own title id', async () => {
    const other = TestBed.createComponent(IslandComponent);
    for (const island of [ fixture, other ]) {
      island.componentRef.setInput('heading', 'Files');
      await island.whenStable();
    }

    const ids = [ fixture, other ].map(island => island.nativeElement.querySelector('h2').id);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('lets the keyboard reach a scrolling body', async () => {
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.body').getAttribute('tabindex')).toBe('0');
  });

  it('leaves scrolling to content that scrolls itself', async () => {
    fixture.componentRef.setInput('scrollable', false);
    await fixture.whenStable();

    const body: HTMLElement = fixture.nativeElement.querySelector('.body');
    expect(body.hasAttribute('tabindex')).toBe(false);
  });

  it('projects header content into the header and the rest into the body', async () => {
    const host = TestBed.createComponent(HostComponent);
    await host.whenStable();

    const element: HTMLElement = host.nativeElement;
    expect(element.querySelector('.header button')?.textContent).toBe('Refresh');
    expect(element.querySelector('.body p')?.textContent).toBe('Body text');
  });
});
