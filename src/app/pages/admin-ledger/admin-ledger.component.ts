import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { LedgerFilters, LedgerResponse, LedgerTransaction } from '../../models/ledger.model';
import { AdminLedgerService } from '../../services/admin-ledger.service';

@Component({
  selector: 'app-admin-ledger', standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-ledger.component.html', styleUrl: './admin-ledger.component.css'
})
export class AdminLedgerComponent implements OnInit, OnDestroy {
  data?: LedgerResponse;
  filters: LedgerFilters = { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' };
  searchText = '';
  loading = true;
  exporting = false;
  error = '';
  selected?: LedgerTransaction;
  detailLoading = false;
  private searchChanges = new Subject<string>();
  private subscription = new Subscription();

  constructor(private ledger: AdminLedgerService) {}
  ngOnInit(): void {
    this.subscription.add(this.searchChanges.pipe(debounceTime(350), distinctUntilChanged()).subscribe(value => {
      this.filters.search = value.trim() || undefined; this.filters.page = 1; this.refresh();
    }));
    this.refresh();
  }
  ngOnDestroy(): void { this.subscription.unsubscribe(); }
  search(): void { this.searchChanges.next(this.searchText); }
  applyFilters(): void {
    if (this.filters.dateFrom && this.filters.dateTo && this.filters.dateFrom > this.filters.dateTo) {
      this.error = 'The start date must be before the end date.'; return;
    }
    this.filters.page = 1; this.refresh();
  }
  clearFilters(): void {
    const pageSize = this.filters.pageSize;
    this.searchText = '';
    this.filters = { page: 1, pageSize, sortBy: 'date', sortDirection: 'desc' };
    this.refresh();
  }
  refresh(): void {
    this.loading = true; this.error = '';
    this.ledger.list(this.filters).subscribe({
      next: data => { this.data = data; this.loading = false; },
      error: error => { this.error = error?.error?.message || 'The financial ledger could not be loaded. Please try again.'; this.loading = false; }
    });
  }
  page(page: number): void {
    if (!this.data || page < 1 || page > this.data.pagination.pages || page === this.filters.page) return;
    this.filters.page = page; this.refresh();
  }
  changePageSize(): void { this.filters.page = 1; this.refresh(); }
  sort(sortBy: string): void {
    if (this.filters.sortBy === sortBy) this.filters.sortDirection = this.filters.sortDirection === 'asc' ? 'desc' : 'asc';
    else { this.filters.sortBy = sortBy; this.filters.sortDirection = sortBy === 'order' ? 'asc' : 'desc'; }
    this.filters.page = 1; this.refresh();
  }
  sortMark(key: string): string { return this.filters.sortBy === key ? (this.filters.sortDirection === 'asc' ? ' ↑' : ' ↓') : ''; }
  view(transaction: LedgerTransaction): void {
    this.selected = transaction; this.detailLoading = true;
    this.ledger.detail(transaction.id).subscribe({
      next: detail => { this.selected = detail; this.detailLoading = false; },
      error: () => { this.detailLoading = false; }
    });
  }
  close(): void { this.selected = undefined; }
  exportExcel(): void {
    if (this.exporting) return;
    this.exporting = true; this.error = '';
    this.ledger.export(this.filters).subscribe({
      next: response => {
        const disposition = response.headers.get('Content-Disposition') || '';
        const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'monk-hagen-ledger.xlsx';
        const url = URL.createObjectURL(response.body || new Blob());
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
        URL.revokeObjectURL(url); this.exporting = false;
      },
      error: () => { this.error = 'The Excel export could not be created. Please try again.'; this.exporting = false; }
    });
  }
  currency(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value); }
  label(value: string | null): string { return value ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '—'; }
  get filtered(): boolean { return Boolean(this.filters.search || this.filters.dateFrom || this.filters.dateTo || this.filters.type || this.filters.direction || this.filters.status || this.filters.paymentMethod); }
}
