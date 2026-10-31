import { TestBed } from '@angular/core/testing';

import { EditorSettingsService } from './editor-settings.service';

describe('EditorSettingsService', () => {
  let service: EditorSettingsService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ EditorSettingsService ] });
    service = TestBed.inject(EditorSettingsService);
  });

  it('wraps long lines at first', () => {
    expect(service.softWrap()).toBe(true);
  });

  it('keeps the choice', () => {
    service.softWrap.set(false);
    expect(service.softWrap()).toBe(false);
  });
});
