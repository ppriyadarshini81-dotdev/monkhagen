import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BannerSettings, BannerSettingsService } from '../../services/banner-settings.service';

@Component({
  selector: 'app-admin-banner', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './admin-banner.component.html', styleUrl: './admin-banner.component.css'
})
export class AdminBannerComponent implements OnInit {
  content: BannerSettings | null = null;
  text = '';
  busy = false;
  error = '';
  notice = '';
  constructor(private settings: BannerSettingsService) {}
  ngOnInit(): void { this.load(); }
  get messages(): string[] { return this.text.split(/\r?\n/).map(value => value.trim()).filter(Boolean); }
  get valid(): boolean { return this.messages.length >= 1 && this.messages.length <= 12 && this.messages.every(value => value.length <= 120); }
  load(): void {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.notice = '';
    this.settings.get().subscribe({
      next: content => { this.content = content; this.text = content.messages.join('\n'); this.busy = false; },
      error: () => { this.error = 'Could not load banner settings. Please retry.'; this.busy = false; }
    });
  }
  save(): void {
    if (!this.content || this.busy || !this.valid) return;
    this.busy = true; this.error = ''; this.notice = '';
    this.settings.save({ messages: this.messages, revision: this.content.revision }).subscribe({
      next: content => { this.content = content; this.text = content.messages.join('\n'); this.busy = false; this.notice = 'Banner saved. The website header has been updated.'; },
      error: err => { this.busy = false; this.error = err?.error?.message || 'Could not save banner settings. Please retry.'; }
    });
  }
}
