import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

type Tab = 'google' | 'email';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  tab: Tab = 'google';
  mode: 'login' | 'register' = 'login';
  name = '';
  email = '';
  password = '';
  error = '';
  loading = false;

  constructor(
    private auth: AuthService,
    private firebase: FirebaseService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  switchTab(tab: Tab): void {
    this.tab = tab;
    this.error = '';
  }

  switchMode(mode: 'login' | 'register'): void {
    this.mode = mode;
    this.error = '';
  }

  // ── Google login (customers) ──────────────────────────────
  async continueWithGoogle(): Promise<void> {
    this.error = '';
    this.loading = true;
    try {
      const idToken = await this.firebase.signInWithGoogle();
      this.auth.loginWithGoogle(idToken).subscribe({
        next: () => { this.loading = false; this.redirectAfterLogin(); },
        error: (err: any) => {
          this.loading = false;
          this.error = err?.error?.message || 'Google sign-in failed.';
        }
      });
    } catch (err: any) {
      this.loading = false;
      if (err?.code !== 'auth/popup-closed-by-user') {
        this.error = err?.message || 'Google sign-in failed.';
      }
    }
  }

  // ── Admin email/password login ────────────────────────────
  fillDemo(): void {
    this.tab = 'email';
    this.mode = 'login';
    this.email = 'admin@monkhagen.com';
    this.password = 'admin123';
  }

  submit(): void {
    this.error = '';
    this.loading = true;
    const done = {
      next: () => { this.loading = false; this.redirectAfterLogin(); },
      error: (err: any) => { this.loading = false; this.error = err?.error?.message || 'Something went wrong.'; }
    };
    if (this.mode === 'login') {
      this.auth.login(this.email, this.password).subscribe(done);
    } else {
      this.auth.register(this.name, this.email, this.password).subscribe(done);
    }
  }

  private redirectAfterLogin(): void {
    const redirect = this.route.snapshot.queryParamMap.get('redirect');
    this.router.navigateByUrl(redirect || '/');
  }
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  // Email/password flow
  tab: Tab = 'phone';
  mode: 'login' | 'register' = 'login';
  name = '';
  email = '';
  password = '';

  // OTP flow
  otpStep: OtpStep = 'phone';
  phone = '';
  otp = '';
  otpName = '';

  error = '';
  loading = false;

  constructor(
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  switchTab(tab: Tab): void {
    this.tab = tab;
    this.error = '';
    this.otpStep = 'phone';
  }

  switchMode(mode: 'login' | 'register'): void {
    this.mode = mode;
    this.error = '';
  }

  fillDemo(role: 'admin' | 'customer'): void {
    this.tab = 'email';
    this.mode = 'login';
    this.email = role === 'admin' ? 'admin@monkhagen.com' : 'demo@monkhagen.com';
    this.password = role === 'admin' ? 'admin123' : 'demo123';
  }

  // ── OTP flow ──────────────────────────────────────────────
  sendOtp(): void {
    this.error = '';
    if (!/^\d{10}$/.test(this.phone)) {
      this.error = 'Enter a valid 10-digit mobile number.';
      return;
    }
    this.loading = true;
    this.auth.sendOtp(this.phone).subscribe({
      next: () => { this.loading = false; this.otpStep = 'otp'; },
      error: (err: any) => { this.loading = false; this.error = err?.error?.message || 'Failed to send OTP.'; }
    });
  }

  verifyOtp(): void {
    this.error = '';
    this.loading = true;
    this.auth.verifyOtp(this.phone, this.otp, this.otpName || undefined).subscribe({
      next: (res) => {
        this.loading = false;
        if (res.isNewUser && !this.otpName) {
          // New user — ask for their name
          this.otpStep = 'name';
        } else {
          this.redirectAfterLogin();
        }
      },
      error: (err: any) => { this.loading = false; this.error = err?.error?.message || 'Invalid OTP.'; }
    });
  }

  confirmName(): void {
    if (!this.otpName.trim()) { this.error = 'Please enter your name.'; return; }
    this.error = '';
    this.loading = true;
    // Re-verify with name — token already stored, just update display name via re-login
    this.auth.verifyOtp(this.phone, this.otp, this.otpName).subscribe({
      next: () => { this.loading = false; this.redirectAfterLogin(); },
      error: () => { this.loading = false; this.redirectAfterLogin(); }
    });
  }

  // ── Email flow ────────────────────────────────────────────
  submit(): void {
    this.error = '';
    this.loading = true;
    const done = {
      next: () => { this.loading = false; this.redirectAfterLogin(); },
      error: (err: any) => { this.loading = false; this.error = err?.error?.message || 'Something went wrong.'; }
    };
    if (this.mode === 'login') {
      this.auth.login(this.email, this.password).subscribe(done);
    } else {
      this.auth.register(this.name, this.email, this.password).subscribe(done);
    }
  }

  private redirectAfterLogin(): void {
    const redirect = this.route.snapshot.queryParamMap.get('redirect');
    this.router.navigateByUrl(redirect || '/');
  }
}
