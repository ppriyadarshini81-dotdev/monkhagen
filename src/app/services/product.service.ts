import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Product } from '../models/product.model';

export interface ProductWrite {
  name: string;
  basePrice: number;
  categoryId: string;
  badgeId: string | null;
  description: string;
  images: string[];
  sizeIds: string[];
  colorIds: string[];
  variants: Array<{
    size: string;
    color: string;
    sizeId: string;
    colorId: string;
    sku?: string | null;
    price?: number | null;
    stock: number;
  }>;
  featured: boolean;
}

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

  getAdminProducts(): Observable<Product[]> {
    return this.http.get<Product[]>(`${this.api}/admin`);
  }

  getAdminProduct(idOrSlug: string): Observable<Product> {
    return this.http.get<Product>(`${this.api}/admin/${idOrSlug}`);
  }

  getProduct(idOrSlug: string): Observable<Product> {
    return this.http.get<Product>(`${this.api}/${idOrSlug}`);
  }

  createProduct(product: ProductWrite): Observable<Product> {
    return this.http.post<Product>(this.api, product);
  }

  updateProduct(id: string, product: ProductWrite): Observable<Product> {
    return this.http.put<Product>(`${this.api}/${id}`, product);
  }

  deleteProduct(id: string): Observable<{ message: string; id: string }> {
    return this.http.delete<{ message: string; id: string }>(`${this.api}/${id}`);
  }
}
