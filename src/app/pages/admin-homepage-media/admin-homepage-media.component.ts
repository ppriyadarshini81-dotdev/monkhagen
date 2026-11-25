import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { HomepageImage, HomepageMedia, InstagramMedia } from '../../models/homepage-media.model';
import { HomepageMediaService } from '../../services/homepage-media.service';

type UploadSection = 'hero' | 'instagram' | 'adVideo' | 'adPoster';

@Component({
  selector: 'app-admin-homepage-media', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './admin-homepage-media.component.html', styleUrl: './admin-homepage-media.component.css'
})
export class AdminHomepageMediaComponent implements OnInit, OnDestroy {
  content: HomepageMedia | null = null;
  loading = false;
  saving = false;
  uploading = false;
  message = '';
  error = '';
  private snapshot = '';
  private readonly requests = new Subscription();

  constructor(private media: HomepageMediaService) {}
  get busy(): boolean { return this.loading || this.saving || this.uploading; }
  get dirty(): boolean { return !!this.content && JSON.stringify(this.content) !== this.snapshot; }
  ngOnInit(): void { this.load(); }

  load(): void {
    if (this.busy) return;
    if (this.dirty && !window.confirm('Discard your unsaved homepage media changes and reload?')) return;
    this.loading = true;
    this.error = ''; this.message = '';
    this.requests.add(this.media.getContent().subscribe({
      next: content => { this.accept(content); this.loading = false; },
      error: () => { this.loading = false; this.error = 'Could not load homepage media. Please retry.'; }
    }));
  }

  private accept(content: HomepageMedia): void {
    this.content = JSON.parse(JSON.stringify(content));
    this.snapshot = JSON.stringify(this.content);
  }

  save(): void {
    if (!this.content || this.busy || !this.dirty) return;
    this.error = ''; this.message = '';
    if (!this.content.heroImages.length || this.content.heroImages.some(image => !image.src.trim()) ||
        this.content.instagramPosts.some(post => !post.src.trim() || !post.url.trim())) {
      this.error = 'Add at least one home header image and complete the media URLs before saving.';
      return;
    }
    this.saving = true;
    this.requests.add(this.media.saveContent(this.content).subscribe({
      next: content => { this.accept(content); this.saving = false; this.message = 'Homepage media saved. Visitors will see these changes when they open the homepage.'; },
      error: error => {
        this.saving = false;
        this.error = error?.status === 409 ? 'Another administrator saved changes. Reload the saved version before trying again. Your draft is still shown below.'
          : error?.error?.message || 'Could not save homepage media. Your changes are still here; please retry.';
      }
    }));
  }

  addImage(section: 'hero' | 'instagram'): void {
    if (!this.content || this.busy) return;
    const items = section === 'hero' ? this.content.heroImages : this.content.instagramPosts;
    if (items.length >= 20) { this.error = 'You can add up to 20 items in each image section.'; return; }
    if (section === 'hero') this.content.heroImages.push({ src: '', alt: '' });
    else this.content.instagramPosts.push({ type: 'image', src: '', alt: '', url: this.content.instagramProfileUrl });
    this.message = '';
  }

  move(items: HomepageImage[], index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (this.busy || target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    this.message = '';
  }

  remove(items: HomepageImage[], index: number): void {
    if (this.busy || (items === this.content?.heroImages && items.length <= 1)) return;
    items.splice(index, 1);
    this.message = '';
  }

  upload(event: Event, section: UploadSection, type: 'image' | 'video', index?: number): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!this.content || !files.length || this.busy) return;
    this.error = ''; this.message = '';
    const maximum = type === 'video' ? 200 * 1024 * 1024 : 10 * 1024 * 1024;
    const allowed = type === 'video' ? ['video/mp4'] : ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    const single = index !== undefined || section === 'adVideo' || section === 'adPoster' || type === 'video';
    const items = section === 'hero' ? this.content.heroImages : this.content.instagramPosts;
    if (files.length > (single ? 1 : 8) || files.some(file => !allowed.includes(file.type) || file.size > maximum || file.size === 0)) {
      this.error = type === 'video' ? 'Choose one MP4 video up to 200 MB.' : 'Choose up to 8 JPG, PNG, WebP or AVIF images, each up to 10 MB.';
      return;
    }
    if ((section === 'hero' || section === 'instagram') && index === undefined && items.length + files.length > 20) {
      this.error = 'You can add up to 20 items in each image section.';
      return;
    }
    this.uploading = true;
    this.requests.add(this.media.upload(files, type).subscribe({
      next: ({ urls }) => {
        this.uploading = false;
        if (!this.content || urls.length !== files.length || urls.some(url => !/^https:\/\//.test(url))) {
          this.error = 'The upload did not return usable media URLs. Please retry.';
          return;
        }
        if (section === 'adVideo') this.content.adVideoUrl = urls[0];
        else if (section === 'adPoster') this.content.adVideoPosterUrl = urls[0];
        else if (index !== undefined) {
          items[index].src = urls[0];
          if (section === 'instagram') (items[index] as InstagramMedia).type = type;
        } else {
          for (const src of urls) {
            if (section === 'hero') this.content.heroImages.push({ src, alt: '' });
            else this.content.instagramPosts.push({ type, src, alt: '', url: this.content.instagramProfileUrl });
          }
        }
        this.message = 'Upload complete. Save changes to publish it on the homepage.';
      },
      error: error => {
        this.uploading = false;
        this.error = error?.status === 429 ? 'Upload limit reached. Please wait before uploading again.'
          : error?.error?.message || 'Upload failed. Please retry.';
      }
    }));
  }

  ngOnDestroy(): void { this.requests.unsubscribe(); }
}
