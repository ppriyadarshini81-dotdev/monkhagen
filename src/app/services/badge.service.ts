import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Badge } from '../models/badge.model';

@Injectable({ providedIn: 'root' })
export class BadgeService {
  private readonly api = '/api/badges';

  constructor(private http: HttpClient) {}

  getBadges(): Observable<Badge[]> {
    return this.http.get<Badge[]>(this.api);
  }

  getAdminBadges(): Observable<Badge[]> {
    return this.http.get<Badge[]>(`${this.api}/admin`);
  }

  createBadge(badge: Pick<Badge, 'name'>): Observable<Badge> {
    return this.http.post<Badge>(this.api, badge);
  }

  updateBadge(id: string, badge: Partial<Badge>): Observable<Badge> {
    return this.http.put<Badge>(`${this.api}/${id}`, badge);
  }

  deleteBadge(id: string): Observable<{ message: string; id: string }> {
    return this.http.delete<{ message: string; id: string }>(`${this.api}/${id}`);
  }
}
