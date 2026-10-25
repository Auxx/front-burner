import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { type IconName } from '../../models/icon-name.model';
import { ICON_SPRITE_URL } from '../../tokens/icon-sprite-url.token';
import { IconComponent } from './icon.component';

@Component({
  imports: [ IconComponent ],
  template: `<ui-icon [name]="name()" [label]="label()" />`
})
class HostComponent {
  readonly name = signal<IconName>('close');
  readonly label = signal<string | undefined>(undefined);
}

describe('IconComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const icon = () => fixture.nativeElement.querySelector('ui-icon') as HTMLElement;
  const href = () => icon().querySelector('use')?.getAttribute('href');

  async function create(providers: unknown[] = []) {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ],
      providers
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  }

  it('draws the named symbol of the sprite', async () => {
    await create();

    expect(href()).toBe('assets/icons.svg#close');
  });

  it('uses the sprite URL that is provided', async () => {
    await create([ { provide: ICON_SPRITE_URL, useValue: '/static/icons.svg' } ]);

    expect(href()).toBe('/static/icons.svg#close');
  });

  it('is hidden from assistive technology without a label', async () => {
    await create();

    expect(icon().getAttribute('aria-hidden')).toBe('true');
    expect(icon().hasAttribute('role')).toBe(false);
    expect(icon().hasAttribute('aria-label')).toBe(false);
  });

  it('is a labelled image with a label', async () => {
    await create();
    fixture.componentInstance.label.set('Ignored by git');
    await fixture.whenStable();

    expect(icon().getAttribute('role')).toBe('img');
    expect(icon().getAttribute('aria-label')).toBe('Ignored by git');
    expect(icon().hasAttribute('aria-hidden')).toBe(false);
  });

  it('follows changes to its name and label', async () => {
    await create();
    fixture.componentInstance.name.set('warning');
    fixture.componentInstance.label.set('Warning');
    await fixture.whenStable();
    fixture.componentInstance.name.set('error');
    fixture.componentInstance.label.set('Error');
    await fixture.whenStable();

    expect(href()).toBe('assets/icons.svg#error');
    expect(icon().getAttribute('aria-label')).toBe('Error');
  });
});
