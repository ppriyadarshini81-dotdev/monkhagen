import { Component, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AccountService } from '../../../services/account.service';
import { Order } from '../../../models/account.model';

@Component({
  selector: 'app-account-orders',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.css'
})
export class AccountOrdersComponent implements OnInit {
  orders: Order[] = [];
  loading = true;
  expandedId: string | null = null;

  constructor(private account: AccountService) {}

  ngOnInit(): void {
    this.account.getOrders().subscribe({
      next: (o) => { this.orders = o; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  toggle(id: string): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      placed: 'grey', confirmed: 'blue', processing: 'blue', shipped: 'orange',
      delivered: 'green', cancelled: 'red', return_requested: 'orange', returned: 'grey'
    };
    return map[status] || 'grey';
  }
}
