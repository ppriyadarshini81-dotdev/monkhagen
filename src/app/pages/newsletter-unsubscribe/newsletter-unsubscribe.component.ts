import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NewsletterService } from '../../services/newsletter.service';

@Component({
  selector: 'app-newsletter-unsubscribe',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './newsletter-unsubscribe.component.html',
  styleUrl: './newsletter-unsubscribe.component.css'
})
export class NewsletterUnsubscribeComponent implements OnInit {
  message = 'Confirming your unsubscribe request…';
  error = '';

  constructor(private route: ActivatedRoute, private newsletter: NewsletterService) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!token) { this.message = ''; this.error = 'This unsubscribe link is invalid.'; return; }
    this.newsletter.unsubscribe(token).subscribe({
      next: ({ message }) => this.message = message,
      error: error => { this.message = ''; this.error = error?.error?.message || 'We could not process this request. Please try again.'; }
    });
  }
}
