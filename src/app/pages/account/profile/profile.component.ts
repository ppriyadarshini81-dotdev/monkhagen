import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AccountService } from '../../../services/account.service';
import { AuthService } from '../../../services/auth.service';
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
  message = '';
  error = '';
  form = { name: '', phone: '', dateOfBirth: '' };

  constructor(private account: AccountService, private auth: AuthService) {}

  ngOnInit(): void {
    this.account.getProfile().subscribe(u => {
      this.user = u;
      this.resetForm();
    });
  }

  resetForm(): void {
    if (!this.user) return;
    this.form = {
      name: this.user.name || '',
      phone: this.user.phone || '',
      dateOfBirth: (this.user as any).dateOfBirth || ''
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
}
