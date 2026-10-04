import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AdminReview, ReviewEligibility, ReviewPage, ReviewSummary } from '../models/review.model';

export type ReviewSort = 'recent' | 'highest' | 'lowest' | 'helpful';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  constructor(private http: HttpClient) {}

  summary(productId: string): Observable<ReviewSummary> {
    return this.http.get<ReviewSummary>(`/api/products/${productId}/reviews/summary`);
  }

  list(productId: string, page = 1, limit = 10, sort: ReviewSort = 'recent'): Observable<ReviewPage> {
    const params = new HttpParams().set('page', page).set('limit', limit).set('sort', sort);
    return this.http.get<ReviewPage>(`/api/products/${productId}/reviews`, { params });
  }

  eligibility(productId: string): Observable<ReviewEligibility> {
    return this.http.get<ReviewEligibility>(`/api/products/${productId}/reviews/eligibility`);
  }

  create(productId: string, rating: number, text: string, images: File[]): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`/api/products/${productId}/reviews`, this.form(rating, text, images));
  }

  update(productId: string, reviewId: string, rating: number, text: string, images: File[], replaceImages: boolean): Observable<{ id: string }> {
    const form = this.form(rating, text, images);
    form.set('replaceImages', String(replaceImages));
    return this.http.patch<{ id: string }>(`/api/products/${productId}/reviews/${reviewId}`, form);
  }

  helpful(productId: string, reviewId: string, helpful: boolean): Observable<{ helpful: boolean; helpfulCount: number }> {
    const url = `/api/products/${productId}/reviews/${reviewId}/helpful`;
    return helpful ? this.http.post<{ helpful: boolean; helpfulCount: number }>(url, {})
      : this.http.delete<{ helpful: boolean; helpfulCount: number }>(url);
  }

  adminList(filters: { search?: string; rating?: number | null; status?: string; page?: number; limit?: number } = {}): Observable<{ reviews: AdminReview[]; total: number }> {
    let params = new HttpParams().set('page', filters.page || 1).set('limit', filters.limit || 100);
    if (filters.search) params = params.set('search', filters.search);
    if (filters.rating) params = params.set('rating', filters.rating);
    if (filters.status) params = params.set('status', filters.status);
    return this.http.get<{ reviews: AdminReview[]; total: number }>('/api/admin/reviews', { params });
  }

  moderate(reviewId: string, status: 'approved' | 'hidden'): Observable<{ id: string; moderationStatus: string }> {
    return this.http.patch<{ id: string; moderationStatus: string }>(`/api/admin/reviews/${reviewId}/moderation`, { status });
  }

  private form(rating: number, text: string, images: File[]): FormData {
    const form = new FormData();
    form.set('rating', String(rating));
    form.set('text', text);
    images.forEach(image => form.append('images', image));
    return form;
  }
}
