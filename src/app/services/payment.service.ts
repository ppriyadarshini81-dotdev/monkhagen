import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface PaymentOrder {
  keyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: 'INR';
  localOrderId: string;
  orderNumber: string;
}

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface VerifiedPayment {
  localOrderId: string;
  orderNumber: string;
  paymentStatus: 'paid';
  orderStatus: string;
}

interface RazorpayCheckout {
  open(): void;
  on(event: 'payment.failed', handler: (response: any) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly api = '/api/payments';

  constructor(private http: HttpClient) {}

  createOrder(addressId: string, checkoutToken: string): Observable<PaymentOrder> {
    return this.http.post<PaymentOrder>(`${this.api}/create-order`, { addressId, checkoutToken });
  }

  verify(localOrderId: string, result: RazorpaySuccess): Observable<VerifiedPayment> {
    return this.http.post<VerifiedPayment>(`${this.api}/verify`, { localOrderId, ...result });
  }

  openCheckout(
    order: PaymentOrder,
    prefill: { name?: string; email?: string; contact?: string }
  ): Promise<RazorpaySuccess> {
    return new Promise((resolve, reject) => {
      if (!window.Razorpay) {
        reject(new Error('Secure payment checkout could not be loaded. Please refresh and try again.'));
        return;
      }
      let settled = false;
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Monk Hagen',
        description: `Order ${order.orderNumber}`,
        order_id: order.razorpayOrderId,
        prefill,
        theme: { color: '#2447eb' },
        handler: (response: RazorpaySuccess) => {
          settled = true;
          resolve(response);
        },
        modal: {
          ondismiss: () => {
            if (!settled) reject(new Error('Payment window was closed. Your cart has not been cleared.'));
          }
        }
      });
      checkout.on('payment.failed', (response: any) => {
        if (!settled) {
          settled = true;
          reject(new Error(response?.error?.description || 'Payment failed. Please try again.'));
        }
      });
      checkout.open();
    });
  }
}
