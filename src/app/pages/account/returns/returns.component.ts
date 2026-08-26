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
      requested: 'orange', approved: 'blue', rejected: 'red',
      pickup_scheduled: 'orange', received: 'blue', completed: 'green', cancelled: 'red'
    };
    return m[s] || 'grey';
  }
}
