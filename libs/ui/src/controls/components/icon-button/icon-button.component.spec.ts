import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IconButtonComponent } from './icon-button.component';

@Component({
  imports: [ IconButtonComponent ],
  template: `
    <button uiIconButton label="Fetch"><svg aria-hidden="true"></svg></button>
    <button uiIconButton label="Show remote images" [pressed]="pressed()"><svg aria-hidden="true"></svg></button>
  `
})
class HostComponent {
  readonly pressed = signal(false);
}

describe('IconButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const buttons = () => fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('is named by its label', () => {
    const fetch = buttons()[0];

    expect(fetch.getAttribute('aria-label')).toBe('Fetch');
    expect(fetch.getAttribute('title')).toBe('Fetch');
    expect(fetch.getAttribute('type')).toBe('button');
  });

  it('is a toggle only when pressed is set', async () => {
    expect(buttons()[0].hasAttribute('aria-pressed')).toBe(false);
    expect(buttons()[1].getAttribute('aria-pressed')).toBe('false');

    fixture.componentInstance.pressed.set(true);
    await fixture.whenStable();

    expect(buttons()[1].getAttribute('aria-pressed')).toBe('true');
  });
});
