import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HomepageMedia } from '../models/homepage-media.model';

@Injectable({ providedIn: 'root' })
export class HomepageMediaService {
  private readonly api = '/api/homepage-media';
  constructor(private http: HttpClient) {}
  getContent(): Observable<HomepageMedia> { return this.http.get<HomepageMedia>(this.api); }
  saveContent(content: HomepageMedia): Observable<HomepageMedia> {
    return this.http.put<HomepageMedia>(this.api, content);
  }
  upload(files: File[], type: 'image' | 'video'): Observable<{ urls: string[] }> {
    const body = new FormData();
    files.forEach(file => body.append('images', file));
    return this.http.post<{ urls: string[] }>(`/api/upload?folder=${type === 'video' ? 'videos' : 'banners'}`, body);
  }
}
