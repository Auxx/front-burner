import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KeyValueComponent } from '../key-value/key-value.component';
import { KeyValueListComponent } from './key-value-list.component';

@Component({
  imports: [ KeyValueComponent, KeyValueListComponent ],
  template: `
    <dl uiKeyValueList>
      <div uiKeyValue label="Clone mode">Single branch: main</div>
      <div uiKeyValue label="Fingerprint" mono>SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8</div>
    </dl>
  `
})
class HostComponent {}

describe('KeyValueListComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const items = () => [ ...(fixture.nativeElement.querySelector('dl') as HTMLElement).children ] as HTMLElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('groups each label and value in a div of the dl', () => {
    expect(items().map(item => item.tagName)).toEqual([ 'DIV', 'DIV' ]);
    for (const item of items()) {
      expect([ ...item.children ].map(child => child.tagName)).toEqual([ 'DT', 'DD' ]);
    }
    expect(items()[0].querySelector('dt')?.textContent).toBe('Clone mode');
    expect(items()[0].querySelector('dd')?.textContent?.trim()).toBe('Single branch: main');
  });

  it('marks monospace values', () => {
    expect(items()[1].hasAttribute('data-mono')).toBe(true);
    expect(items()[0].hasAttribute('data-mono')).toBe(false);
  });
});
