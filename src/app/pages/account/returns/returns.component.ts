import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AccountService } from '../../../services/account.service';
import { ReturnRequest } from '../../../models/account.model';

@Component({
  selector: 'app-account-returns',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule],
  templateUrl: './returns.component.html',
  styleUrl: './returns.component.css'
})
export class AccountReturnsComponent implements OnInit {
  returns: ReturnRequest[] = [];
  loading = true;
  refundFormReturnId = '';
  refundMethod: 'UPI' | 'BANK' = 'UPI';
  upiId = ''; confirmUpiId = '';
  accountHolderName = ''; accountNumber = ''; confirmAccountNumber = ''; ifsc = ''; bankName = '';
  refundSaving = false; refundError = '';

  constructor(private account: AccountService) {}

  ngOnInit(): void {
    this.account.getReturns().subscribe({
      next: (r) => { this.returns = r; this.loading = false; },
      error: () => { this.loading = false; }
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
      requested: 'Return requested', return_created: 'Awaiting pickup scheduling', shiprocket_failed: 'Return creation delayed',
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
