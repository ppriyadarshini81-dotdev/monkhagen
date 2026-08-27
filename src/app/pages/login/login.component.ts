import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

type Tab = 'google' | 'email';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  tab: Tab = 'google';
  email = '';
  password = '';
  error = '';
  loading = false;

  constructor(
    private auth: AuthService,
    private firebase: FirebaseService,
    private router: Router
  ) {}

  switchTab(tab: Tab): void {
    this.tab = tab;
    this.error = '';
  }

  // ── Google login (customers) ──────────────────────────────
  async continueWithGoogle(): Promise<void> {
    this.error = '';
    this.loading = true;
    try {
      const idToken = await this.firebase.signInWithGoogle();
      this.auth.loginWithGoogle(idToken).subscribe({
        next: () => {
          this.loading = false;
          this.router.navigateByUrl('/');
        },
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
    this.email = 'admin@monkhagen.com';
    this.password = 'admin123';
  }

  submit(): void {
    this.error = '';
    this.loading = true;
    const done = {
      next: () => { this.loading = false; this.router.navigateByUrl('/'); },
      error: (err: any) => { this.loading = false; this.error = err?.error?.message || 'Something went wrong.'; }
    };
    this.auth.login(this.email, this.password).subscribe(done);
  }
}
