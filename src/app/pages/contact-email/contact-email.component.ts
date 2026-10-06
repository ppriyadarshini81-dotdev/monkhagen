import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ContactService } from '../../services/contact.service';

@Component({
  selector: 'app-contact-email',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contact-email.component.html',
  styleUrl: './contact-email.component.css'
})
export class ContactEmailComponent {
  form = { name: '', email: '', query: '' };
  sending = false;
  submitted = false;
  success = '';
  error = '';

  constructor(private contactService: ContactService) {}

  submit(): void {
    if (this.sending) return;

    this.success = '';
    this.error = '';
    this.submitted = true;
    if (!this.validName || !this.validEmail || !this.validQuery) {
      this.error = 'Please complete all required fields with valid details.';
      return;
    }
    this.sending = true;

    this.contactService.sendQuery({
      name: this.form.name.trim(),
      email: this.form.email.trim(),
      query: this.form.query.trim()
    }).subscribe({
      next: ({ message }) => {
        this.sending = false;
        this.success = message;
        this.form = { name: '', email: '', query: '' };
        this.submitted = false;
      },
      error: (err) => {
        this.sending = false;
        this.error = err?.error?.message || 'We could not send your query. Please try again.';
      }
    });
  }

  get validName(): boolean { return this.form.name.trim().length > 0 && /[\p{L}\p{N}]/u.test(this.form.name); }
  get validEmail(): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.form.email.trim()); }
  get validQuery(): boolean {
    const query = this.form.query.trim();
    return query.length >= 10 && query.length <= 5000 && /[\p{L}\p{N}]/u.test(query);
  }
}
