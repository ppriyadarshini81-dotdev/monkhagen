import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NgForm } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';
import { LoginComponent } from './login.component';

describe('LoginComponent registration', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let firebase: jasmine.SpyObj<FirebaseService>;

  beforeEach(async () => {
    firebase = jasmine.createSpyObj<FirebaseService>('FirebaseService', ['createEmailAccount']);
    firebase.createEmailAccount.and.resolveTo();
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: {} },
        { provide: FirebaseService, useValue: firebase }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    component.setMode('register');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  async function fillRegistration(password: string, confirmation = password): Promise<void> {
    component.name = 'Test Customer';
    component.email = 'customer@example.com';
    component.password = password;
    component.confirmPassword = confirmation;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function form(): NgForm {
    return fixture.debugElement.query(By.directive(NgForm)).injector.get(NgForm);
  }

  it('requires a special character and at least eight characters in both password fields', async () => {
    await fillRegistration('password');
    expect(form().controls['password'].hasError('pattern')).toBeTrue();
    expect(form().controls['confirmPassword'].hasError('pattern')).toBeTrue();
    await component.submitEmail(form());
    expect(firebase.createEmailAccount).not.toHaveBeenCalled();

    await fillRegistration('Secure!123');
    expect(form().valid).toBeTrue();
  });

  it('shows a mismatch on blur and clears it when the confirmation matches', async () => {
    await fillRegistration('Secure!123', 'Different!123');
    const input: HTMLInputElement = fixture.nativeElement.querySelector('[name="confirmPassword"]');
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#confirm-password-feedback').textContent).toContain('Passwords do not match.');
    await component.submitEmail(form());
    expect(firebase.createEmailAccount).not.toHaveBeenCalled();

    component.confirmPassword = component.password;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#confirm-password-feedback')).toBeNull();
  });

  it('keeps registration blank and opens the verification confirmation after success', async () => {
    await fillRegistration('Secure!123');
    await component.submitEmail(form());
    fixture.detectChanges();
    await fixture.whenStable();
    expect(firebase.createEmailAccount).toHaveBeenCalledWith('Test Customer', 'customer@example.com', 'Secure!123');
    expect(component.mode).toBe('register');
    expect([component.name, component.email, component.password, component.confirmPassword]).toEqual(['', '', '', '']);
    expect(form().pristine).toBeTrue();
    const dialog: HTMLDialogElement = fixture.nativeElement.querySelector('dialog');
    expect(dialog.open).toBeTrue();
    expect(dialog.textContent).toContain('Please verify your email before signing in.');
    expect(fixture.nativeElement.querySelector('.mh-btn--google')).toBeNull();
    const buttons: NodeListOf<HTMLButtonElement> = dialog.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent?.trim()).toBe('Okay');
    buttons[0].click();
    fixture.detectChanges();
    expect(dialog.open).toBeFalse();
    expect(component.mode).toBe('signin');
    expect(component.email).toBe('');
    expect(component.password).toBe('');
    expect(fixture.nativeElement.querySelector('.mh-btn--google')).not.toBeNull();
  });

  it('does not show a success popup when verification-email sending fails', async () => {
    firebase.createEmailAccount.and.rejectWith({ code: 'auth/network-request-failed' });
    await fillRegistration('Secure!123');
    await component.submitEmail(form());
    expect(fixture.nativeElement.querySelector('dialog').open).toBeFalse();
    expect(component.error).toContain('Could not connect.');
    expect(component.email).toBe('customer@example.com');
    expect(component.loading).toBeFalse();
  });
});
