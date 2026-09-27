import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, QueryList, ViewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnDestroy {
  @ViewChildren('otpInput') otpInputs!: QueryList<ElementRef<HTMLInputElement>>;
  phone = '';
  otpDigits = ['', '', '', '', '', ''];
  step: 'phone' | 'otp' = 'phone';
  error = '';
  notice = '';
  loading = false;
  submitted = false;
  resendRemaining = 0;
  private countdown?: ReturnType<typeof setInterval>;
  private readonly redirectUrl: string;

  constructor(
    private auth: AuthService,
    private firebase: FirebaseService,
    private router: Router,
    route: ActivatedRoute
  ) {
    const requested = route.snapshot.queryParamMap.get('redirect');
    this.redirectUrl = requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/';
  }

  get normalizedPhone(): string {
    return this.phone.replace(/\D/g, '').slice(-10);
  }

  get maskedPhone(): string {
    const phone = this.normalizedPhone;
    return phone.length === 10 ? `+91 XXXXXXX${phone.slice(-3)}` : '+91';
  }

  get otp(): string {
    return this.otpDigits.join('');
  }

  trackOtpInput(index: number): number {
    return index;
  }

  async sendOtp(): Promise<void> {
    this.submitted = true;
    this.error = '';
    this.notice = '';
    if (!/^[6-9]\d{9}$/.test(this.normalizedPhone) || this.loading) return;

    this.loading = true;
    try {
      await firstValueFrom(this.auth.sendOtp(this.normalizedPhone));
      this.step = 'otp';
      this.otpDigits = ['', '', '', '', '', ''];
      this.startCountdown();
      queueMicrotask(() => this.focusOtp(0));
    } catch (error: unknown) {
      this.error = this.getFriendlyError(error, 'We could not send the verification code. Please try again.');
    } finally {
      this.loading = false;
    }
  }

  async verifyOtp(): Promise<void> {
    this.error = '';
    this.notice = '';
    if (!/^\d{6}$/.test(this.otp) || this.loading) {
      this.error = 'Enter the complete 6-digit verification code.';
      return;
    }

    this.loading = true;
    try {
      await firstValueFrom(this.auth.verifyOtp(this.normalizedPhone, this.otp));
      await this.router.navigateByUrl(this.redirectUrl);
    } catch (error: unknown) {
      this.error = this.getFriendlyError(error, 'We could not verify the code. Please try again.');
    } finally {
      this.loading = false;
    }
  }

  async resendOtp(): Promise<void> {
    if (this.resendRemaining > 0 || this.loading) return;
    await this.sendOtp();
    if (!this.error) this.notice = 'A new verification code was sent.';
  }

  changePhone(): void {
    this.clearCountdown();
    this.step = 'phone';
    this.otpDigits = ['', '', '', '', '', ''];
    this.error = '';
    this.notice = '';
    this.submitted = false;
  }

  onOtpInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '').slice(-1);
    this.otpDigits = this.otpDigits.map((digit, position) => position === index ? value : digit);
    input.value = value;
    if (value && index < 5) queueMicrotask(() => this.focusOtp(index + 1));
  }

  onOtpKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.otpDigits[index] && index > 0) this.focusOtp(index - 1);
    if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); this.focusOtp(index - 1); }
    if (event.key === 'ArrowRight' && index < 5) { event.preventDefault(); this.focusOtp(index + 1); }
  }

  onOtpPaste(event: ClipboardEvent): void {
    const digits = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6) || '';
    if (!digits) return;
    event.preventDefault();
    this.otpDigits = Array.from({ length: 6 }, (_, index) => digits[index] || '');
    queueMicrotask(() => this.focusOtp(Math.min(digits.length, 6) - 1));
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
      if (this.errorCode(error) !== 'auth/popup-closed-by-user') {
        this.error = this.getFriendlyError(error, 'Google sign-in failed. Please try again.');
      }
    } finally {
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.clearCountdown();
  }

  private startCountdown(): void {
    this.clearCountdown();
    this.resendRemaining = 45;
    this.countdown = setInterval(() => {
      this.resendRemaining -= 1;
      if (this.resendRemaining <= 0) this.clearCountdown();
    }, 1000);
  }

  private clearCountdown(): void {
    if (this.countdown) clearInterval(this.countdown);
    this.countdown = undefined;
    if (this.resendRemaining < 0) this.resendRemaining = 0;
  }

  private focusOtp(index: number): void {
    this.otpInputs?.get(index)?.nativeElement.focus();
  }

  private getFriendlyError(error: unknown, fallback: string): string {
    const code = this.errorCode(error);
    if (code === 'auth/network-request-failed') return 'Could not connect. Check your internet connection and try again.';
    if (typeof error === 'object' && error && 'status' in error) {
      const status = Number((error as { status?: unknown }).status);
      if (status === 0) return 'Could not connect. Check your internet connection and try again.';
      if (status === 429) return 'Too many attempts. Please wait before trying again.';
      if (status >= 500) return 'The verification service is temporarily unavailable. Please try again later.';
    }
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
