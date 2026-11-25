import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';

export interface BannerSettings { messages: string[]; revision: number; updatedAt?: string; }
export const DEFAULT_BANNER_MESSAGES = ['Free shipping across India', 'COD available', 'Premium streetwear', 'Limited drops'];

@Injectable({ providedIn: 'root' })
export class BannerSettingsService {
  readonly messages$ = new BehaviorSubject<string[]>(DEFAULT_BANNER_MESSAGES);
  constructor(private http: HttpClient) {}
  get(): Observable<BannerSettings> {
    return this.http.get<BannerSettings>('/api/banner-settings').pipe(tap(content => this.messages$.next(content.messages)));
  }
  save(content: BannerSettings): Observable<BannerSettings> {
    return this.http.put<BannerSettings>('/api/banner-settings', content).pipe(tap(saved => this.messages$.next(saved.messages)));
  }
}
