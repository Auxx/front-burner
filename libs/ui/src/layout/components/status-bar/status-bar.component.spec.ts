import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusBarComponent } from './status-bar.component';

@Component({
  imports: [ StatusBarComponent ],
  template: `
    <ui-status-bar label="Status">
      <span>main</span>
      <span uiStatusBarEnd>Saved</span>
    </ui-status-bar>
  `
})
class HostComponent {}

describe('StatusBarComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let statusBar: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    statusBar = fixture.nativeElement.querySelector('ui-status-bar');
  });

  it('is a named group', () => {
    expect(statusBar.getAttribute('role')).toBe('group');
    expect(statusBar.getAttribute('aria-label')).toBe('Status');
  });

  it('puts its content at the start and marked content at the end', () => {
    expect(statusBar.querySelector('.start')?.textContent?.trim()).toBe('main');
    expect(statusBar.querySelector('.end')?.textContent?.trim()).toBe('Saved');
  });
});
