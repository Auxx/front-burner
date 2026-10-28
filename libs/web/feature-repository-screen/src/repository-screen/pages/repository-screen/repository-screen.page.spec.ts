import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';

import { RepositoryScreenPage } from './repository-screen.page';

describe('RepositoryScreenPage', () => {
  let component: RepositoryScreenPage;
  let fixture: ComponentFixture<RepositoryScreenPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RepositoryScreenPage,
        TranslocoTestingModule.forRoot({
          langs: {},
          translocoConfig: {
            availableLangs: [ 'en' ],
            defaultLang: 'en'
          }
        })
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(RepositoryScreenPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
