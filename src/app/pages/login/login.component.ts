import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

type EmailMode = 'signin' | 'register' | 'forgot';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  @ViewChild('accountCreatedDialog') accountCreatedDialog!: ElementRef<HTMLDialogElement>;
  readonly registrationPasswordPattern = /^(?=.*[^a-zA-Z0-9\s]).{8,}$/;
  mode: EmailMode = 'signin';
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  error = '';
  notice = '';
  loading = false;
  submitted = false;
  showPassword = false;
  showConfirmPassword = false;
  private readonly redirectUrl: string;

  constructor(
    private auth: AuthService,
    private firebase: FirebaseService,
    private router: Router,
    route: ActivatedRoute
  ) {
    const requested = route.snapshot.queryParamMap.get('redirect');
    this.redirectUrl = requested?.startsWith('/') && !requested.startsWith('//')
      ? requested
      : '/';
  }

  setMode(mode: EmailMode): void {
    this.mode = mode;
    this.error = '';
    this.notice = '';
    this.password = '';
    this.confirmPassword = '';
    this.submitted = false;
    this.showPassword = false;
    this.showConfirmPassword = false;
  }

  closeAccountCreatedDialog(): void {
    this.accountCreatedDialog.nativeElement.close();
    this.setMode('signin');
  }

  async submitEmail(form: NgForm): Promise<void> {
    this.submitted = true;
    this.error = '';
    this.notice = '';

    if (form.invalid) return;

    const email = this.email.trim().toLowerCase();
    if (this.mode === 'register' && (
      !this.registrationPasswordPattern.test(this.password) ||
      this.password !== this.confirmPassword
    )) {
      return;
    }

    this.loading = true;
    try {
      if (this.mode === 'register') {
        await this.firebase.createEmailAccount(this.name.trim(), email, this.password);
        this.name = '';
        this.email = '';
        this.password = '';
        this.confirmPassword = '';
        this.showPassword = false;
        this.showConfirmPassword = false;
        this.submitted = false;
        form.resetForm({ name: '', email: '', password: '', confirmPassword: '' });
        this.accountCreatedDialog.nativeElement.showModal();
        return;
      }

      if (this.mode === 'forgot') {
        await this.firebase.sendPasswordReset(email);
        this.notice = 'If an account exists for this email, a password-reset link has been sent.';
        return;
      }

      const idToken = await this.firebase.signInWithEmail(email, this.password);
      await firstValueFrom(this.auth.loginWithFirebase(idToken));
      await this.router.navigateByUrl(this.redirectUrl);
    } catch (error: unknown) {
      this.error = this.getFriendlyError(error);
    } finally {
      this.loading = false;
    }
  }

  async continueWithGoogle(): Promise<void> {
    this.error = '';
    this.notice = '';
    this.loading = true;
    try {
      const idToken = await this.firebase.signInWithGoogle();
      await firstValueFrom(this.auth.loginWithFirebase(idToken));
      await this.router.navigateByUrl(this.redirectUrl);
    } catch (error: unknown) {
      const code = this.errorCode(error);
      if (code !== 'auth/popup-closed-by-user') {
        this.error = this.getFriendlyError(error, 'Google sign-in failed. Please try again.');
      }
    } finally {
      this.loading = false;
    }
  }

  private getFriendlyError(error: unknown, fallback = 'Sign-in failed. Please try again.'): string {
    const code = this.errorCode(error);
    const messages: Record<string, string> = {
      'auth/email-already-in-use': 'An account already uses this email. Sign in instead or continue with Google.',
      'auth/email-not-verified': 'Please verify your email. We sent you a new verification link.',
      'auth/invalid-credential': 'The email or password is incorrect.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
      'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
      'auth/network-request-failed': 'Could not connect. Check your internet connection and try again.',
      'auth/operation-not-allowed': 'Email sign-in is not enabled yet.'
    };
    if (messages[code]) return messages[code];

    if (typeof error === 'object' && error && 'error' in error) {
      const apiError = (error as { error?: { message?: unknown } }).error;
      if (typeof apiError?.message === 'string') return apiError.message;
    }
    return fallback;
  }

  private errorCode(error: unknown): string {
    if (typeof error !== 'object' || !error || !('code' in error)) return '';
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : '';
  }
}
