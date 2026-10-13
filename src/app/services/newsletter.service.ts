import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NewsletterService {
  constructor(private http: HttpClient) {}

  subscribe(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/newsletter', { email });
  }

  unsubscribe(token: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/newsletter/unsubscribe', { token });
  }
}
