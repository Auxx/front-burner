import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { EditorAreaComponent } from './editor-area.component';

describe('EditorAreaComponent', () => {
  let fixture: ComponentFixture<EditorAreaComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [ EditorAreaComponent, translocoTesting() ] });
    fixture = TestBed.createComponent(EditorAreaComponent);
    await settle(fixture);
  });

  it('shows the empty state', () => {
    expect((fixture.nativeElement as HTMLElement).querySelector('ui-empty-state')?.textContent?.trim()).toBe(
      'web-feature-repository-screen.EditorAreaComponent.empty'
    );
  });
});
