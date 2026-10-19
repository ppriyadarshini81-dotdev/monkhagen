import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { User } from '../../../models/user.model';
import { AccountService } from '../../../services/account.service';
import { AuthService } from '../../../services/auth.service';
import { FirebaseService } from '../../../services/firebase.service';
import { AccountProfileComponent } from './profile.component';

describe('AccountProfileComponent email recovery', () => {
  let fixture: ComponentFixture<AccountProfileComponent>;
  let component: AccountProfileComponent;
  let account: jasmine.SpyObj<AccountService>;
  let auth: jasmine.SpyObj<AuthService>;
  let firebase: jasmine.SpyObj<FirebaseService>;

  const phoneUser: User = {
    id: 'phone-user', name: 'User', email: null, phone: '9876543210', role: 'customer',
    profileImage: null, firebaseUid: null, googleUid: null, phoneVerified: true, emailVerified: false
  };
  const recoveredUser: User = {
    ...phoneUser, id: 'google-user', name: 'Existing Customer', email: 'customer@example.com',
    firebaseUid: 'google-uid', googleUid: 'google-uid', emailVerified: true
  };

  beforeEach(async () => {
    account = jasmine.createSpyObj<AccountService>('AccountService', ['getProfile', 'updateProfile']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['refreshUser', 'linkGoogleAccount']);
    firebase = jasmine.createSpyObj<FirebaseService>('FirebaseService', ['signInWithGoogle']);
    account.getProfile.and.returnValue(of(phoneUser));
    account.updateProfile.and.returnValue(of(phoneUser));
    firebase.signInWithGoogle.and.resolveTo('google-token');
    auth.linkGoogleAccount.and.returnValue(of({ token: 'new-session', user: recoveredUser }));

    await TestBed.configureTestingModule({
      imports: [AccountProfileComponent],
      providers: [
        { provide: AccountService, useValue: account },
        { provide: AuthService, useValue: auth },
        { provide: FirebaseService, useValue: firebase }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(AccountProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('asks an unlinked phone user to verify an existing account email', () => {
    expect(fixture.nativeElement.querySelector('.mh-profile__email-prompt').textContent)
      .toContain('Verify its Google email');
    expect(auth.refreshUser).toHaveBeenCalledOnceWith(phoneUser);
  });

  it('restores the verified Google account only after matching email verification', async () => {
    component.startEdit();
    component.form.email = ' Customer@Example.com ';
    await component.verifyEmail();

    expect(firebase.signInWithGoogle).toHaveBeenCalled();
    expect(auth.linkGoogleAccount).toHaveBeenCalledOnceWith('customer@example.com', 'google-token');
    expect(component.user).toEqual(recoveredUser);
    expect(component.editing).toBeFalse();
    expect(component.message).toContain('saved account details');
  });

  it('does not open Google for an invalid email address', async () => {
    component.form.email = 'not-an-email';
    await component.verifyEmail();
    expect(firebase.signInWithGoogle).not.toHaveBeenCalled();
    expect(component.error).toContain('valid email');
  });

  it('shows a verified email without verification controls when editing', () => {
    component.user = recoveredUser;
    component.resetForm();
    component.startEdit();
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.mh-profile__email-link')?.textContent).toContain('customer@example.com');
    expect(root.querySelector('.mh-profile__email-link .mh-badge')?.textContent).toContain('Verified');
    expect(root.querySelector('#profile-email')).toBeNull();
    expect(root.querySelector('.mh-profile__email-link button')).toBeNull();
    expect(root.querySelector('#profile-name')).not.toBeNull();
    expect(root.querySelector('#profile-phone')).not.toBeNull();
  });
});
