import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface ShipmentResult {
  orderId: string;
  shiprocketOrderId: string | number | null;
  shiprocketShipmentId: string | number | null;
  shippingStatus: string;
  lastErrorCode: string | null;
}

@Injectable({ providedIn: 'root' })
export class ShippingService {
  private readonly api = '/api/shipping';

  constructor(private http: HttpClient) {}

  createShipment(orderId: string): Observable<ShipmentResult> {
    return this.http.post<ShipmentResult>(`${this.api}/create-shipment`, { orderId });
  }
}
