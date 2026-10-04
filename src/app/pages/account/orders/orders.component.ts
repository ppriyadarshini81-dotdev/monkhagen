import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountService } from '../../../services/account.service';
import { Order, ReturnEligibility, TrackingInfo } from '../../../models/account.model';
import { saveInvoice } from '../../../utils/invoice-download';

@Component({
  selector: 'app-account-orders',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.css'
})
export class AccountOrdersComponent implements OnInit {
  @ViewChild('detailsDialog') detailsDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('trackingDialog') trackingDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('returnDialog') returnDialog?: ElementRef<HTMLDialogElement>;

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
  returnEligibility: ReturnEligibility | null = null;
  returnEligibilityLoading = false;
  returnError = '';
  returnMessage = '';
  returnSubmitting = false;
  returnOrder: Order | null = null;
  returnIdempotencyKey = '';
  returnReasons: ReturnEligibility['reasons'] = [];
  returnRows: Array<{ orderItemId: string; productName: string; selected: boolean; quantity: number; max: number; reason: string; comments: string }> = [];

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
    this.returnEligibility = null;
    this.returnEligibilityLoading = true;
    this.account.getReturnEligibility(order.id).subscribe({
      next: eligibility => { this.returnEligibility = eligibility; this.returnEligibilityLoading = false; },
      error: error => {
        this.returnEligibility = { orderId: order.id, eligible: false, reason: 'UNAVAILABLE',
          message: error?.error?.message || 'Return availability could not be checked.', returnUntil: null, reasons: [], items: [] };
        this.returnEligibilityLoading = false;
      }
    });
    queueMicrotask(() => this.detailsDialog?.nativeElement.showModal());
  }

  openReturn(order: Order): void {
    const eligibility = this.returnEligibility;
    if (!eligibility?.eligible) return;
    this.returnOrder = order;
    this.returnIdempotencyKey = this.newUuid();
    this.returnReasons = [...eligibility.reasons];
    this.returnError = '';
    this.returnRows = eligibility.items.filter(item => item.remainingQuantity > 0).map(item => ({
      orderItemId: item.orderItemId, productName: item.productName, selected: false,
      quantity: 1, max: item.remainingQuantity, reason: '', comments: ''
    }));
    this.closeDetails();
    queueMicrotask(() => this.returnDialog?.nativeElement.showModal());
  }

  closeReturn(): void { this.returnDialog?.nativeElement.close(); }

  submitReturn(): void {
    if (!this.returnOrder || !this.returnIdempotencyKey || this.returnSubmitting) return;
    const selected = this.returnRows.filter(row => row.selected);
    if (!selected.length) { this.returnError = 'Select at least one item.'; return; }
    if (selected.some(row => !row.reason || row.quantity < 1 || row.quantity > row.max || (row.reason === 'other' && !row.comments.trim()))) {
      this.returnError = 'Choose a valid quantity and reason for every selected item. Add an explanation for Other.';
      return;
    }
    this.returnSubmitting = true;
    this.returnError = '';
    this.account.createReturn({
      orderId: this.returnOrder.id,
      idempotencyKey: this.returnIdempotencyKey,
      items: selected.map(row => ({ orderItemId: row.orderItemId, quantity: Number(row.quantity),
        reason: row.reason, ...(row.comments.trim() ? { comments: row.comments.trim() } : {}) }))
    }).subscribe({
      next: result => {
        this.returnSubmitting = false;
        this.returnMessage = result.pickupDelayed
          ? 'We received your return request, but pickup scheduling is taking longer than expected.'
          : 'Your return request has been created and pickup is being scheduled.';
        this.returnIdempotencyKey = '';
        this.closeReturn();
      },
      error: error => {
        this.returnSubmitting = false;
        this.returnError = error?.error?.message || 'We could not create the return request. Please try again.';
      }
    });
  }

  quantityOptions(max: number): number[] {
    return Array.from({ length: max }, (_, index) => index + 1);
  }

  private newUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const value = Math.floor(Math.random() * 16);
      return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
    });
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
    this.returnEligibility = null;
  }

  clearReturn(): void {
    this.returnOrder = null;
    this.returnIdempotencyKey = '';
    this.returnReasons = [];
    this.returnRows = [];
    this.returnError = '';
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
