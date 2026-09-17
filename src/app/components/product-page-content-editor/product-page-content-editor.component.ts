import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ProductPageContent } from '../../models/product-page-content.model';
import { ProductPageContentService } from '../../services/product-page-content.service';
import { UploadService } from '../../services/upload.service';

@Component({
  selector: 'app-product-page-content-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-page-content-editor.component.html',
  styleUrl: './product-page-content-editor.component.css'
})
export class ProductPageContentEditorComponent implements OnInit {
  content?: ProductPageContent;
  private savedContent?: ProductPageContent;
  loading = false;
  saving = false;
  uploading = false;
  submitted = false;
  error = '';
  message = '';

  constructor(private contentService: ProductPageContentService, private uploadService: UploadService) {}

  ngOnInit(): void {
    this.loadContent();
  }

  loadContent(): void {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    this.contentService.getContent().subscribe({
      next: content => {
        this.content = { ...content };
        this.savedContent = { ...content };
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load product page content. Please retry.';
        this.loading = false;
      }
    });
  }

  get sizeChartInvalid(): boolean {
    const value = this.content?.sizeChartImageUrl.trim();
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol !== 'https:' || Boolean(url.username || url.password);
    } catch { return true; }
  }

  save(form: NgForm): void {
    if (!this.content || this.saving || this.uploading) return;
    this.submitted = true;
    this.error = '';
    this.message = '';
    if (form.invalid || this.sizeChartInvalid || !this.content.deliveryEstimate.trim()) return;
    this.saving = true;
    this.contentService.saveContent(this.content).subscribe({
      next: content => {
        this.content = { ...content };
        this.savedContent = { ...content };
        form.resetForm(content);
        this.submitted = false;
        this.saving = false;
        this.message = 'Saved. This content is shared across all product pages.';
      },
      error: error => {
        this.error = error?.error?.message || 'Could not save content. Your changes are still here; please retry.';
        this.saving = false;
      }
    });
  }

  discard(form: NgForm): void {
    if (!this.savedContent || this.saving || this.uploading) return;
    this.content = { ...this.savedContent };
    form.resetForm(this.content);
    this.submitted = false;
    this.error = '';
    this.message = '';
  }

  uploadSizeChart(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.content || this.uploading || this.saving) return;
    this.error = '';
    this.message = '';
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      this.error = 'Choose a JPEG, PNG, WebP or AVIF image no larger than 10 MB.';
      input.value = '';
      return;
    }
    this.uploading = true;
    this.uploadService.uploadImages([file]).subscribe({
      next: ({ urls }) => {
        if (urls[0] && this.content) this.content.sizeChartImageUrl = urls[0];
        else this.error = 'The upload did not return an image URL. Please retry.';
        this.uploading = false;
        input.value = '';
      },
      error: error => {
        this.error = error?.error?.message || 'Could not upload the size chart. Please retry.';
        this.uploading = false;
        input.value = '';
      }
    });
  }
}
