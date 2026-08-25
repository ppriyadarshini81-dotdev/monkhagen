import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Product } from '../models/product.model';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly api = '/api/products';

  constructor(private http: HttpClient) {}

  getProducts(filters?: {
    category?: string;
    search?: string;
    featured?: boolean;
  }): Observable<Product[]> {
    const params: Record<string, string> = {};
    if (filters?.category && filters.category !== 'All') {
      params['category'] = filters.category;
    }
    if (filters?.search) {
      params['search'] = filters.search;
    }
    if (filters?.featured) {
      params['featured'] = 'true';
    }
    return this.http.get<Product[]>(this.api, { params });
  }

  getCategories(): Observable<string[]> {
    return this.http.get<string[]>(`${this.api}/categories`);
  }

  getProduct(idOrSlug: string): Observable<Product> {
    return this.http.get<Product>(`${this.api}/${idOrSlug}`);
  }

  createProduct(product: Partial<Product>): Observable<Product> {
    return this.http.post<Product>(this.api, product);
  }

  updateProduct(id: string, product: Partial<Product>): Observable<Product> {
    return this.http.put<Product>(`${this.api}/${id}`, product);
  }

  deleteProduct(id: string): Observable<{ message: string; id: string }> {
    return this.http.delete<{ message: string; id: string }>(`${this.api}/${id}`);
  }
}
