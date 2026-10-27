import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitLevel } from '@front-burner/shared-contracts';
import { CredentialsApi } from '@front-burner/web-api-client';

import { FormHostComponent, hostWith } from '../../../testing/form-host';
import { openSelect, selectOptions } from '../../../testing/form-testing';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { LevelSectionComponent } from './level-section.component';

const KEY = 'web-feature-repositories.LevelSectionComponent';

describe('LevelSectionComponent', () => {
  let fixture: ComponentFixture<FormHostComponent>;

  const page = () => fixture.nativeElement as HTMLElement;

  async function open(allowed: GitLevel[]): Promise<void> {
    hostWith(
      `<repo-level-section [gitLevel]="model.gitLevel" [allowed]="${JSON.stringify(allowed).replace(/"/g, '\'')}" />`,
      [ LevelSectionComponent ]
    );
    await TestBed.configureTestingModule({
      imports: [ FormHostComponent, translocoTesting() ],
      providers: [ { provide: CredentialsApi, useValue: {} } ]
    }).compileComponents();
    fixture = TestBed.createComponent(FormHostComponent);
    await settle(fixture);
  }

  afterEach(() => document.querySelector('.cdk-overlay-container')?.replaceChildren());

  it('lists the allowed levels from Simple to Advanced, each with a description', async () => {
    await open([ 'advanced', 'simple' ]);

    openSelect(page(), `${KEY}.label`);
    await settle(fixture);

    const options = selectOptions();
    expect(options.map(option => option.textContent?.trim())).toEqual([
      `${KEY}.levels.simple${KEY}.descriptions.simple`,
      `${KEY}.levels.advanced${KEY}.descriptions.advanced`
    ]);
  });

  it('hides the level with one allowed level', async () => {
    await open([ 'guided' ]);

    expect(page().querySelector('ui-field')).toBeNull();
    expect(page().textContent?.trim()).toBe('');
  });
});
