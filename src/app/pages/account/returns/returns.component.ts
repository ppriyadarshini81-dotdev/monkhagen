import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AccountService } from '../../../services/account.service';
import { ReturnRequest } from '../../../models/account.model';
import { FEATURE_FLAGS } from '../../../config/feature-flags';

@Component({
  selector: 'app-account-returns',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, RouterLink],
  templateUrl: './returns.component.html',
  styleUrl: './returns.component.css'
})
export class AccountReturnsComponent implements OnInit, OnDestroy {
  @ViewChild('returnDetailsDialog') returnDetailsDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('cancelReturnDialog') cancelReturnDialog?: ElementRef<HTMLDialogElement>;
  readonly codEnabled = FEATURE_FLAGS.cashOnDelivery;
  returns: ReturnRequest[] = [];
  loading = true;
  page = 0; readonly pageSize = 10; hasNextPage = false;
  statusFilter = '';
  orderId = '';
  loadError = '';
  private routeSubscription?: Subscription;
  private returnsSubscription?: Subscription;
  refundFormReturnId = '';
  refundMethod: 'UPI' | 'BANK' = 'UPI';
  upiId = ''; confirmUpiId = '';
  accountHolderName = ''; accountNumber = ''; confirmAccountNumber = ''; ifsc = ''; bankName = '';
  refundSaving = false; refundError = '';
  cancellingReturnId = '';
  returnToCancel: ReturnRequest | null = null;
  cancellationError = '';
  selectedReturn: ReturnRequest | null = null;

  constructor(private account: AccountService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.routeSubscription = this.route.queryParamMap.subscribe(params => {
      this.orderId = params.get('orderId') || '';
      this.returns = [];
      this.loadReturns(0);
    });
  }
  ngOnDestroy(): void { this.routeSubscription?.unsubscribe(); this.returnsSubscription?.unsubscribe(); }
  loadReturns(page = this.page): void {
    this.returnsSubscription?.unsubscribe();
    this.loading = true; this.loadError = '';
    this.returnsSubscription = this.account.getReturns(this.pageSize, page * this.pageSize, this.statusFilter, this.orderId).subscribe({
      next: (r) => { this.returns = r; this.page = page; this.hasNextPage = r.length === this.pageSize; this.loading = false; },
      error: error => { this.loadError = error?.error?.message || 'We could not load your requests. Please try again.'; this.loading = false; }
    });
  }
  changePage(direction: number): void {
    const next = this.page + direction;
    if (next < 0 || (direction > 0 && !this.hasNextPage)) return;
    this.loadReturns(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  applyStatusFilter(): void { this.loadReturns(0); }

  requestTypeLabel(request: ReturnRequest): string {
    if (request.requestType === 'replacement') return 'Size replacement requested';
    if (request.requestType === 'defect') return 'Defective item return requested';
    return 'Return requested';
  }

  canCancelReturn(item: ReturnRequest): boolean { return ['requested', 'return_created', 'shiprocket_failed'].includes(item.status) && !item.cancellationPending && !(item.status === 'requested' && item.pickupDelayed); }
  openReturnDetails(item: ReturnRequest): void { this.selectedReturn = item; queueMicrotask(() => this.returnDetailsDialog?.nativeElement.showModal()); }
  closeReturnDetails(): void { this.returnDetailsDialog?.nativeElement.close(); }
  clearReturnDetails(): void { this.selectedReturn = null; }
  cancelReturn(item: ReturnRequest): void {
    if (this.cancellingReturnId || !this.canCancelReturn(item)) return;
    this.returnToCancel = item;
    this.cancellationError = '';
    queueMicrotask(() => {
      const dialog = this.cancelReturnDialog?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    });
  }
  closeCancellation(): void {
    if (this.cancellingReturnId) return;
    this.cancelReturnDialog?.nativeElement.close();
    this.clearCancellation();
  }
  clearCancellation(): void {
    if (this.cancellingReturnId) return;
    this.returnToCancel = null;
    this.cancellationError = '';
  }
  handleCancellationEscape(event: Event): void {
    if (this.cancellingReturnId) event.preventDefault();
  }
  confirmCancellation(): void {
    const item = this.returnToCancel;
    if (!item || this.cancellingReturnId || !this.canCancelReturn(item)) return;
    this.cancellingReturnId = item.id;
    this.cancellationError = '';
    this.account.cancelReturn(item.id).subscribe({
      next: () => { this.cancellingReturnId = ''; this.closeCancellation(); this.loadReturns(); },
      error: error => {
        this.cancellingReturnId = '';
        this.cancellationError = error?.error?.message || 'We could not confirm cancellation. Please refresh the request status before trying again.';
      }
    });
  }

  statusClass(s: string): string {
    const m: Record<string, string> = {
      requested: 'orange', return_created: 'orange', shiprocket_failed: 'orange',
      pickup_scheduled: 'orange', picked_up: 'blue', in_transit: 'blue', received: 'blue',
      approved: 'blue', refund_initiated: 'orange', refunded: 'green',
      pickup_failed: 'red', rejected: 'red', cancelled: 'red'
    };
    return m[s] || 'grey';
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      requested: 'Return requested', return_created: 'Awaiting return initiation', shiprocket_failed: 'Return creation delayed',
      pickup_scheduled: 'Pickup scheduled', picked_up: 'Picked up', in_transit: 'In transit',
      received: 'Received', approved: 'Approved', refund_initiated: 'Refund processing', refunded: 'Refund completed',
      pickup_failed: 'Pickup needs attention', manual_required: 'Manual refund required'
    };
    return labels[status] || status.replace(/_/g, ' ');
  }

  progress(status: string): number {
    const order = ['requested','return_created','pickup_scheduled','picked_up','in_transit','received','approved','refund_initiated','refunded'];
    return Math.max(0, order.indexOf(status));
  }

  requestStatusLabel(request: ReturnRequest): string {
    if (request.defectPhotoReviewPending) return 'Awaiting photo review';
    if (request.replacementShipmentPending) return 'Outbound shipment needs review';
    if (request.shiprocketOutboundOrderId) return 'Outbound shipment ' + (request.outboundStatus || 'created').toLowerCase();
    return this.statusLabel(request.status);
  }

  returnStage(status: string): number {
    if (['approved', 'refund_initiated', 'refunded'].includes(status)) return 5;
    if (status === 'received') return 4;
    if (status === 'in_transit') return 3;
    if (status === 'picked_up') return 2;
    if (status === 'pickup_scheduled') return 1;
    return 0;
  }

  itemTrackingStage(request: ReturnRequest, item: ReturnRequest['items'][number]): number {
    const stage = this.returnStage(request.status);
    if (stage < 4) return stage;
    if (request.requestType !== 'replacement' && item.inspectionStatus !== 'rejected') {
      if (['refund_initiated', 'refunded'].includes(request.status)) return 5;
      return request.status === 'approved' ? 4 : 3;
    }
    if (!item.inspectionStatus || item.inspectionStatus === 'pending') return 3;
    return request.shiprocketOutboundOrderId || request.outboundAwb || request.outboundCreatedAt ? 5 + (request.outboundStage || 0) : 4;
  }

  itemTrackingOutcome(request: ReturnRequest, item: ReturnRequest['items'][number]): string {
    return item.inspectionStatus === 'rejected' ? 'Original item return' : request.requestType === 'replacement' ? 'Replacement' : 'Refund';
  }

  itemJourneyTitle(request: ReturnRequest, item: ReturnRequest['items'][number]): string {
    if (request.defectPhotoReviewPending) return 'Awaiting admin photo review';
    if (this.returnStage(request.status) < 4) return this.statusLabel(request.status);
    if (!item.inspectionStatus || item.inspectionStatus === 'pending') return 'Awaiting inspection';
    return item.inspectionStatus === 'approved' ? (request.requestType === 'replacement' ? 'Replacement approved' : 'Return approved')
      : (request.requestType === 'replacement' ? 'Replacement rejected' : 'Return rejected');
  }

  itemJourneyDetail(request: ReturnRequest, item: ReturnRequest['items'][number]): string {
    if (request.defectPhotoReviewPending) return 'Your photos are awaiting review. Pickup is arranged after admin review.';
    if (this.returnStage(request.status) < 4) {
      return request.returnAwb ? `Shared return shipment · AWB ${request.returnAwb}` : 'All selected products are travelling together to Monk Hagen.';
    }
    if (!item.inspectionStatus || item.inspectionStatus === 'pending') return 'Warehouse inspection is pending for this product.';
    if (request.requestType !== 'replacement' && item.inspectionStatus === 'approved') {
      return `${request.refundAmount ? 'Refund after shipping deduction: ₹' + request.refundAmount : 'No refund payable after shipping deduction'}${item.inspectionReason ? ' · ' + item.inspectionReason : ''}`;
    }
    const shipment = request.outboundAwb ? `AWB ${request.outboundAwb}` : (request.outboundStatus || 'Outbound shipment is being prepared');
    return item.inspectionStatus === 'approved'
      ? `Replacement size ${item.replacementSize || 'selected'} · ${shipment}`
      : `The original product will be sent back · ${shipment}${item.inspectionReason ? ` · ${item.inspectionReason}` : ''}`;
  }

  openRefundForm(item: ReturnRequest): void {
    this.clearRefundForm(); this.refundFormReturnId = item.id; this.refundMethod = item.refundDestination.method || 'UPI';
  }

  clearRefundForm(): void {
    this.refundFormReturnId = ''; this.upiId = ''; this.confirmUpiId = ''; this.accountHolderName = '';
    this.accountNumber = ''; this.confirmAccountNumber = ''; this.ifsc = ''; this.bankName = ''; this.refundError = '';
  }

  submitRefundDestination(item: ReturnRequest): void {
    this.refundError = '';
    if (this.refundMethod === 'UPI' && this.upiId.trim().toLowerCase() !== this.confirmUpiId.trim().toLowerCase()) {
      this.refundError = 'UPI IDs do not match.'; return;
    }
    if (this.refundMethod === 'BANK' && this.accountNumber.trim() !== this.confirmAccountNumber.trim()) {
      this.refundError = 'Account numbers do not match.'; return;
    }
    const payload = this.refundMethod === 'UPI'
      ? { method: 'UPI' as const, upiId: this.upiId, confirmUpiId: this.confirmUpiId }
      : { method: 'BANK' as const, accountHolderName: this.accountHolderName, accountNumber: this.accountNumber,
        confirmAccountNumber: this.confirmAccountNumber, ifsc: this.ifsc, bankName: this.bankName };
    this.refundSaving = true;
    this.account.saveCodRefundDestination(item.id, payload).subscribe({
      next: destination => { item.refundDestination = destination; item.status = 'refund_initiated'; item.refundStatus = 'processing';
        this.refundSaving = false; this.clearRefundForm(); },
      error: error => { this.refundSaving = false; this.refundError = error?.error?.message || 'Refund details could not be saved.'; }
    });
  }

  refundDestinationStatus(item: ReturnRequest): string {
    const status = item.refundDestination.status;
    if (item.refundDestination.required) return 'Refund details required';
    if (status === 'PROVIDED') return 'Refund details received';
    if (status === 'PROCESSING') return 'Refund processing';
    if (status === 'FAILED') return 'Refund pending retry';
    if (status === 'COMPLETED' || status === 'REDACTED') return 'Refund completed';
    return this.statusLabel(item.refundStatus);
  }
}
