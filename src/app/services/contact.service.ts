import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface ContactQuery {
  name: string;
  email: string;
  query: string;
}

@Injectable({ providedIn: 'root' })
export class ContactService {
  private readonly api = '/api/contact';

  constructor(private http: HttpClient) {}

  sendQuery(payload: ContactQuery): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(this.api, payload);
  }
}
