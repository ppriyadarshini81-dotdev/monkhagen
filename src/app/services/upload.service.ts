import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly api = '/api/upload';

  constructor(private http: HttpClient) {}

  // Uploads image files to Cloudinary via the API and returns their URLs.
  uploadImages(files: FileList | File[]): Observable<{ urls: string[] }> {
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('images', file));
    return this.http.post<{ urls: string[] }>(this.api, form);
  }
}
