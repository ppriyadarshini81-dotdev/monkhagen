import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ProductPageContent } from '../models/product-page-content.model';

@Injectable({ providedIn: 'root' })
export class ProductPageContentService {
  private readonly api = '/api/product-page-content';

  constructor(private http: HttpClient) {}

  getContent(): Observable<ProductPageContent> {
    return this.http.get<ProductPageContent>(this.api);
  }

  saveContent(content: ProductPageContent): Observable<ProductPageContent> {
    return this.http.put<ProductPageContent>(this.api, {
      sizeChartImageUrl: content.sizeChartImageUrl,
      careInstructions: content.careInstructions,
      deliveryEstimate: content.deliveryEstimate,
      deliveryNote: content.deliveryNote
    });
  }
}
