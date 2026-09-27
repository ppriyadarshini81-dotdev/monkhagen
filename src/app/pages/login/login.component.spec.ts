import { ComponentFixture, fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';
import { LoginComponent } from './login.component';

describe('LoginComponent customer authentication', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let auth: jasmine.SpyObj<AuthService>;
  let firebase: jasmine.SpyObj<FirebaseService>;
  let router: Router;

  beforeEach(async () => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['sendOtp', 'verifyOtp', 'loginWithFirebase']);
    firebase = jasmine.createSpyObj<FirebaseService>('FirebaseService', ['signInWithGoogle']);
    auth.sendOtp.and.returnValue(of({ message: 'Verification code sent.' }));
    auth.verifyOtp.and.returnValue(of({ token: 'token', user: { id: 'id', name: 'Customer', email: null,
      phone: '9876543210', role: 'customer', profileImage: null, googleUid: null } }));
    auth.loginWithFirebase.and.returnValue(of({ token: 'token', user: { id: 'id', name: 'Customer',
      email: 'customer@example.test', phone: null, role: 'customer', profileImage: null, googleUid: 'uid' } }));
    firebase.signInWithGoogle.and.resolveTo('firebase-token');

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: FirebaseService, useValue: firebase }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows mobile OTP and Google choices without customer email/password controls', () => {
    expect(fixture.nativeElement.querySelector('#customer-phone')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="email"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="password"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mh-btn--google').textContent).toContain('Continue with Google');
  });

  it('validates an Indian mobile number before requesting OTP', async () => {
    component.phone = '1234567890';
    await component.sendOtp();
    expect(auth.sendOtp).not.toHaveBeenCalled();
    component.phone = '9876543210';
    await component.sendOtp();
    expect(auth.sendOtp).toHaveBeenCalledOnceWith('9876543210');
    expect(component.step).toBe('otp');
    expect(component.maskedPhone).toBe('+91 XXXXXXX210');
  });

  it('supports pasting six digits and verifies through the backend', async () => {
    component.phone = '9876543210';
    await component.sendOtp();
    fixture.detectChanges();
    const paste = new ClipboardEvent('paste', { clipboardData: new DataTransfer() });
    paste.clipboardData?.setData('text', '654321');
    component.onOtpPaste(paste);
    fixture.detectChanges();
    expect(component.otp).toBe('654321');
    await component.verifyOtp();
    expect(auth.verifyOtp).toHaveBeenCalledOnceWith('9876543210', '654321');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('keeps a typed digit in only its own OTP box', fakeAsync(() => {
    component.step = 'otp';
    fixture.detectChanges();
    const inputs = fixture.nativeElement.querySelectorAll('.mh-otp input') as NodeListOf<HTMLInputElement>;

    inputs[0].value = '9';
    inputs[0].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.otpDigits).toEqual(['9', '', '', '', '', '']);
    expect(inputs[0].value).toBe('9');
    expect(inputs[1].value).toBe('');
    flushMicrotasks();
    expect(document.activeElement).toBe(inputs[1]);
  }));

  it('shows a friendly throttling message', async () => {
    auth.sendOtp.and.returnValue(throwError(() => ({ status: 429, error: { message: 'raw' } })));
    component.phone = '9876543210';
    await component.sendOtp();
    expect(component.error).toContain('Too many attempts');
  });

  it('keeps Firebase Google sign-in working', async () => {
    await component.continueWithGoogle();
    expect(firebase.signInWithGoogle).toHaveBeenCalled();
    expect(auth.loginWithFirebase).toHaveBeenCalledOnceWith('firebase-token');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });
});
