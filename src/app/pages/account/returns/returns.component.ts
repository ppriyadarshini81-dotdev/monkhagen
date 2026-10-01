import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { AccountService } from '../../../services/account.service';
import { ReturnRequest } from '../../../models/account.model';

@Component({
  selector: 'app-account-returns',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './returns.component.html',
  styleUrl: './returns.component.css'
})
export class AccountReturnsComponent implements OnInit {
  returns: ReturnRequest[] = [];
  loading = true;

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
}
