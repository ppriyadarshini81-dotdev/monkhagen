import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AccountService } from '../../../services/account.service';
import { AuthService } from '../../../services/auth.service';
import { FirebaseService } from '../../../services/firebase.service';
import { User } from '../../../models/user.model';

@Component({
  selector: 'app-account-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css'
})
export class AccountProfileComponent implements OnInit {
  user: User | null = null;
  editing = false;
  saving = false;
  verifyingEmail = false;
  message = '';
  error = '';
  form = { name: '', phone: '', dateOfBirth: '', email: '' };

  constructor(
    private account: AccountService,
    private auth: AuthService,
    private firebase: FirebaseService
  ) {}

  ngOnInit(): void {
    this.account.getProfile().subscribe(u => {
      this.user = u;
      this.auth.refreshUser(u);
      this.resetForm();
    });
  }

  resetForm(): void {
    if (!this.user) return;
    this.form = {
      name: this.user.name || '',
      phone: this.user.phone || '',
      dateOfBirth: this.user.dateOfBirth || '',
      email: this.user.email || ''
    };
  }

  startEdit(): void { this.editing = true; this.message = ''; this.error = ''; }
  cancelEdit(): void { this.editing = false; this.resetForm(); }

  save(): void {
    this.error = '';
    this.saving = true;
    this.account.updateProfile({
      name: this.form.name,
      phone: this.form.phone || undefined,
      dateOfBirth: this.form.dateOfBirth || undefined
    }).subscribe({
      next: (u) => {
        this.user = u;
        this.auth.refreshUser(u);
        this.saving = false;
        this.editing = false;
        this.message = 'Profile updated.';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to save.';
        this.saving = false;
      }
    });
  }

  async verifyEmail(): Promise<void> {
    const email = this.form.email.trim().toLowerCase();
    this.error = '';
    this.message = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error = 'Enter a valid email address.';
      return;
    }
    if (this.verifyingEmail) return;

    this.verifyingEmail = true;
    try {
      const idToken = await this.firebase.signInWithGoogle();
      const response = await firstValueFrom(this.auth.linkGoogleAccount(email, idToken));
      this.user = response.user;
      this.resetForm();
      this.editing = false;
      this.message = 'Email verified. Your saved account details are now available.';
    } catch (error: any) {
      if (error?.code !== 'auth/popup-closed-by-user') {
        this.error = error?.error?.message || 'Email verification failed. Please try again.';
      }
    } finally {
      this.verifyingEmail = false;
    }
  }
}
