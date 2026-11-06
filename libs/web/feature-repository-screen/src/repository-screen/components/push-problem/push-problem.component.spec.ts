import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';

import { PushProblemComponent } from './push-problem.component';

describe('PushProblemComponent', () => {
  let component: PushProblemComponent;
  let fixture: ComponentFixture<PushProblemComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        PushProblemComponent,
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

    fixture = TestBed.createComponent(PushProblemComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
