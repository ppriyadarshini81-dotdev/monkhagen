import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { VariantOption } from '../models/variant-option.model';

type OptionType = 'sizes' | 'colors';

@Injectable({ providedIn: 'root' })
export class VariantOptionService {
  constructor(private http: HttpClient) {}

  getOptions(type: OptionType): Observable<VariantOption[]> {
    return this.http.get<VariantOption[]>(`/api/${type}`);
  }

  createOption(type: OptionType, name: string): Observable<VariantOption> {
    return this.http.post<VariantOption>(`/api/${type}`, { name });
  }

  updateOption(type: OptionType, id: string, name: string): Observable<VariantOption> {
    return this.http.put<VariantOption>(`/api/${type}/${id}`, { name });
  }

  deleteOption(type: OptionType, id: string): Observable<{ message: string; id: string }> {
    return this.http.delete<{ message: string; id: string }>(`/api/${type}/${id}`);
  }
}
