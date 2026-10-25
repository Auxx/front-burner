import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { PopoverTriggerDirective } from '../../directives/popover-trigger/popover-trigger.directive';
import { PopoverComponent } from './popover.component';

@Component({
  imports: [ ButtonComponent, PopoverComponent, PopoverTriggerDirective ],
  template: `
    <button uiButton [uiPopoverTrigger]="info">Couldn't check for remote changes</button>
    <ui-popover #info="uiPopover" label="Remote check failed">
      <p>The server did not answer.</p>
      <button uiButton size="small">Try again</button>
    </ui-popover>
    <button uiButton [uiPopoverTrigger]="plain">Details</button>
    <ui-popover #plain="uiPopover" label="Details"><p>Only text.</p></ui-popover>
    <button>Elsewhere</button>
  `
})
class HostComponent {}

describe('PopoverComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const button = (text: string) =>
    [ ...document.querySelectorAll('button') ].find(element =>
      element.textContent?.trim() === text
    ) as HTMLButtonElement;
  const trigger = () => button('Couldn\'t check for remote changes');
  const popover = (label = 'Remote check failed') =>
    document.querySelector(`ui-popover[aria-label="${label}"]`) as HTMLElement;
  const stable = () => fixture.whenStable();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await stable();
  });

  it('is a closed, labelled non-modal dialog controlled by its trigger', () => {
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-controls')).toBe(popover().id);
    expect(popover().getAttribute('role')).toBe('dialog');
    expect(popover().hidden).toBe(true);
  });

  it('opens on click and moves the focus inside', async () => {
    trigger().click();
    await stable();

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(popover().hidden).toBe(false);
    expect(popover().closest('.cdk-overlay-container')).not.toBeNull();
    expect(document.activeElement).toBe(button('Try again'));
  });

  it('focuses itself when it holds nothing focusable', async () => {
    button('Details').click();
    await stable();

    expect(document.activeElement).toBe(popover('Details'));
  });

  it('closes on Escape and returns the focus to its trigger', async () => {
    trigger().click();
    await stable();

    button('Try again').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await stable();

    expect(popover().hidden).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when the focus or a click goes elsewhere', async () => {
    trigger().click();
    await stable();
    button('Elsewhere').focus();
    await stable();

    expect(popover().hidden).toBe(true);
    expect(document.activeElement).toBe(button('Elsewhere'));

    trigger().click();
    await stable();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await stable();

    expect(popover().hidden).toBe(true);
  });

  it('closes and hands the focus to its trigger when Tab leaves its last element', async () => {
    trigger().click();
    await stable();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    button('Try again').dispatchEvent(tab);
    await stable();

    expect(popover().hidden).toBe(true);
    // The browser then moves on from the trigger, so Tab is not cancelled.
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  it('closes and returns to its trigger on Shift+Tab from its first element', async () => {
    trigger().click();
    await stable();

    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    button('Try again').dispatchEvent(shiftTab);
    await stable();

    expect(popover().hidden).toBe(true);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('leaves Tab alone between its own elements', async () => {
    trigger().click();
    await stable();
    const first = document.createElement('button');
    first.textContent = 'First';
    popover().prepend(first);

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await stable();

    expect(popover().hidden).toBe(false);
  });

  it('toggles from its trigger', async () => {
    trigger().click();
    await stable();
    trigger().click();
    await stable();

    expect(popover().hidden).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });
});
