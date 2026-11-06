import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';

import { PushButtonComponent } from './push-button.component';

describe('PushButtonComponent', () => {
  let component: PushButtonComponent;
  let fixture: ComponentFixture<PushButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        PushButtonComponent,
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

    fixture = TestBed.createComponent(PushButtonComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
