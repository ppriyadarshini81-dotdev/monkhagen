import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { AccountService } from '../../../services/account.service';
import { CreditTransaction } from '../../../models/account.model';

@Component({
  selector: 'app-account-credits',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './credits.component.html',
  styleUrl: './credits.component.css'
})
export class AccountCreditsComponent implements OnInit {
  balance = 0;
  transactions: CreditTransaction[] = [];
  loading = true;

  constructor(private account: AccountService) {}

  ngOnInit(): void {
    this.account.getCredits().subscribe(c => this.balance = c.balance);
    this.account.getCreditTransactions().subscribe({
      next: (t) => { this.transactions = t; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }
}
