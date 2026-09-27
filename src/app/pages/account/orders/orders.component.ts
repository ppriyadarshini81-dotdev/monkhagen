import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { AccountService } from '../../../services/account.service';
import { Order, TrackingInfo } from '../../../models/account.model';
import { saveInvoice } from '../../../utils/invoice-download';

@Component({
  selector: 'app-account-orders',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.css'
})
export class AccountOrdersComponent implements OnInit {
  @ViewChild('detailsDialog') detailsDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('trackingDialog') trackingDialog?: ElementRef<HTMLDialogElement>;

  orders: Order[] = [];
  loading = true;
  loadError = '';
  selectedOrder: Order | null = null;
  trackingOrder: Order | null = null;
  tracking: TrackingInfo | null = null;
  trackingLoading = false;
  trackingError = '';
  invoiceLoadingOrderId = '';
  invoiceError = '';

  constructor(private account: AccountService) {}

  ngOnInit(): void {
    this.account.getOrders().subscribe({
      next: (orders) => {
        this.orders = orders;
        this.loading = false;
      },
      error: () => {
        this.loadError = 'We could not load your orders. Please refresh and try again.';
        this.loading = false;
      }
    });
  }

  openDetails(order: Order): void {
    this.selectedOrder = order;
    queueMicrotask(() => this.detailsDialog?.nativeElement.showModal());
  }

  closeDetails(): void {
    this.detailsDialog?.nativeElement.close();
  }

  openTracking(order: Order): void {
    this.trackingOrder = order;
    this.tracking = null;
    this.trackingError = '';
    this.trackingLoading = true;
    queueMicrotask(() => {
      const dialog = this.trackingDialog?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    });
    this.account.getTracking(order.id).subscribe({
      next: (tracking) => {
        this.tracking = tracking;
        this.trackingLoading = false;
      },
      error: (error) => {
        this.trackingError = error?.error?.message || 'Tracking information is temporarily unavailable.';
        this.trackingLoading = false;
      }
    });
  }

  trackFromDetails(order: Order): void {
    this.closeDetails();
    queueMicrotask(() => this.openTracking(order));
  }

  closeTracking(): void {
    this.trackingDialog?.nativeElement.close();
  }

  downloadInvoice(order: Order): void {
    if (!order.invoiceAvailable || this.invoiceLoadingOrderId) return;
    this.invoiceError = '';
    this.invoiceLoadingOrderId = order.id;
    this.account.getInvoice(order.id).subscribe({
      next: (response) => {
        this.invoiceLoadingOrderId = '';
        try { saveInvoice(response, `${order.orderNumber}_Invoice.pdf`); }
        catch { this.invoiceError = 'Invoice is not available yet. Please try again later.'; }
      },
      error: () => {
        this.invoiceLoadingOrderId = '';
        this.invoiceError = 'Invoice is not available yet. Please try again later.';
      }
    });
  }

  clearDetails(): void {
    this.selectedOrder = null;
  }

  clearTracking(): void {
    this.trackingOrder = null;
    this.tracking = null;
    this.trackingError = '';
  }

  orderStage(order: Order): number {
    const orderStatus = (order.status || '').toLowerCase();
    const shippingStatus = (order.shippingStatus || '').toLowerCase();
    if (order.deliveredAt || orderStatus === 'delivered' || shippingStatus.includes('delivered')) return 4;
    if (order.shippedAt || order.awbNumber || ['shipped', 'pickup_scheduled', 'awb_assigned'].some((value) =>
      orderStatus === value || shippingStatus.includes(value))) return 3;
    if (orderStatus === 'processing' || !['', 'not_created', 'pending'].includes(shippingStatus)) return 2;
    return 1;
  }

  trackingStage(order: Order, tracking: TrackingInfo | null): number {
    if (!tracking) return this.orderStage(order);
    const status = `${tracking.shippingStatus || ''} ${tracking.trackingStatus || ''}`.toLowerCase();
    if (status.includes('deliver')) return 4;
    if (tracking.awbCode || status.includes('ship') || status.includes('pickup')) return 3;
    if (!status.includes('not_created') && !status.includes('pending')) return 2;
    return 1;
  }

  deliveryLabel(order: Order): string {
    const stage = this.orderStage(order);
    if (stage === 4) return 'Delivered';
    if (stage === 3) return 'On the way';
    if (stage === 2) return 'Preparing shipment';
    return 'Order confirmed';
  }

  statusLabel(status: string | null | undefined): string {
    if (!status) return 'Awaiting update';
    return status.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  }

  isPendingCod(order: Order): boolean {
    return order.paymentMethod === 'cod' && order.paymentStatus === 'pending';
  }

  paymentMethodLabel(order: Order): string {
    return order.paymentMethod === 'cod' ? 'Cash on delivery' : this.statusLabel(order.paymentMethod);
  }
}
