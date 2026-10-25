import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';

import { LoginPage } from './login.page';

describe('LoginPage', () => {
  let component: LoginPage;
  let fixture: ComponentFixture<LoginPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        LoginPage,
        TranslocoTestingModule.forRoot({
          langs: {
            en: {
              'web-feature-auth.LoginPage.title': 'Log in',
              'web-feature-auth.LoginPage.message': 'Signing in isn\'t available yet.'
            }
          },
          preloadLangs: true,
          translocoConfig: {
            availableLangs: [ 'en' ],
            defaultLang: 'en'
          }
        })
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the heading and the message', () => {
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('h2')?.textContent).toBe('Log in');
    expect(page.textContent).toContain('Signing in isn\'t available yet.');
  });
});
