import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContactService } from '../../services/contact.service';

@Component({
  selector: 'app-contact-email',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './contact-email.component.html',
  styleUrl: './contact-email.component.css'
})
export class ContactEmailComponent {
  form = { name: '', email: '', query: '' };
  sending = false;
  success = '';
  error = '';

  constructor(private contactService: ContactService) {}

  submit(): void {
    if (this.sending) return;

    this.success = '';
    this.error = '';
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
      },
      error: (err) => {
        this.sending = false;
        this.error = err?.error?.message || 'We could not send your query. Please try again.';
      }
    });
  }
}
