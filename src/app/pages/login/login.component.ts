import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  error = '';
  loading = false;
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

  async continueWithGoogle(): Promise<void> {
    this.error = '';
    this.loading = true;
    try {
      const idToken = await this.firebase.signInWithGoogle();
      this.auth.loginWithGoogle(idToken).subscribe({
        next: () => {
          this.loading = false;
          this.router.navigateByUrl(this.redirectUrl);
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
}
