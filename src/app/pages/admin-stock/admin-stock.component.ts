import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { StockItem, StockMovement, StockResponse } from '../../models/stock.model';
import { AdminStockService, StockFilters } from '../../services/admin-stock.service';
import { CategoryService } from '../../services/category.service';
import { VariantOptionService } from '../../services/variant-option.service';
import { Category } from '../../models/category.model';
import { VariantOption } from '../../models/variant-option.model';
import { sortSizes } from '../../utils/size-order';

interface ProductStockGroup {
  productId: string; name: string; imageUrl: string | null; category: string;
  items: StockItem[]; units: number; low: number; out: number; setup: number;
}

@Component({ selector: 'app-admin-stock', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './admin-stock.component.html', styleUrl: './admin-stock.component.css' })
export class AdminStockComponent implements OnInit, OnDestroy {
  data?: StockResponse; categories: Category[] = []; sizes: VariantOption[] = []; loading = true; error = '';
  filters: StockFilters = { page: 1, limit: 25, status: 'ALL', sort: 'lowest' };
  selected?: StockItem; adjustment: number | null = null; reason = ''; saving = false;
  historyItem?: StockItem; movements: StockMovement[] = []; historyLoading = false;
  productGroups: ProductStockGroup[] = [];
  private expandedProducts = new Set<string>();

  private groupProducts(items: StockItem[]): void {
    const groups = new Map<string, ProductStockGroup>();
    for (const item of items) {
      let group = groups.get(item.productId);
      if (!group) {
        group = { productId: item.productId, name: item.productName, imageUrl: item.imageUrl,
          category: item.category, items: [], units: 0, low: 0, out: 0, setup: 0 };
        groups.set(item.productId, group);
      }
      group.items.push(item);
      if (item.configured) group.units += item.currentStock;
      if (item.status === 'LOW_STOCK') group.low++;
      if (item.status === 'OUT_OF_STOCK') group.out++;
      if (item.status === 'SETUP_REQUIRED') group.setup++;
    }
    this.productGroups = [...groups.values()];
    for (const group of this.productGroups) {
      const order = sortSizes(group.items.map(item => item.size));
      group.items.sort((a, b) => order.indexOf(a.size) - order.indexOf(b.size));
    }
  }
  isExpanded(productId: string): boolean { return this.expandedProducts.has(productId); }
  toggleProduct(productId: string): void {
    if (this.expandedProducts.has(productId)) this.expandedProducts.delete(productId);
    else this.expandedProducts.add(productId);
  }
  private search$ = new Subject<string>(); private destroy$ = new Subject<void>();
  constructor(private stock: AdminStockService, private categoryService: CategoryService, private options: VariantOptionService) {}
  ngOnInit(): void {
    this.search$.pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(value => {
      this.filters.search = value.trim(); this.filters.page = 1; this.load();
    });
    this.categoryService.getAdminCategories().subscribe(value => this.categories = value);
    this.options.getAdminOptions('sizes').subscribe(value => { const order = sortSizes(value.map(item => item.name)); this.sizes = [...value].sort((a,b) => order.indexOf(a.name)-order.indexOf(b.name)); });
    this.load();
  }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
  load(): void { this.loading = true; this.error = ''; this.stock.list(this.filters).subscribe({
    next: value => { this.data = value; this.groupProducts(value.items); this.loading = false; },
    error: error => { this.error = error?.error?.message || 'Stock information could not be loaded.'; this.loading = false; }
  }); }
  search(value: string): void { this.search$.next(value); }
  filterChanged(): void { this.filters.page = 1; this.load(); }
  page(delta: number): void { if (!this.data) return; const next = this.filters.page + delta; if (next < 1 || next > this.data.pagination.pages) return; this.filters.page = next; this.load(); }
  openAdjust(item: StockItem): void { this.selected = item; this.adjustment = null; this.reason = ''; this.error = ''; }
  closeAdjust(): void { if (!this.saving) this.selected = undefined; }
  get adjustmentResult(): number { return (this.selected?.currentStock || 0) + Number(this.adjustment || 0); }
  saveAdjustment(): void {
    if (!this.selected || !Number.isSafeInteger(Number(this.adjustment)) || Number(this.adjustment) === 0 || this.reason.trim().length < 2 || this.adjustmentResult < 0) {
      this.error = 'Enter a non-zero whole-number adjustment, a reason, and keep the result at zero or above.'; return;
    }
    this.saving = true; this.stock.adjust(this.selected.inventoryId, Number(this.adjustment), this.reason.trim()).subscribe({
      next: () => { this.saving = false; this.selected = undefined; this.load(); },
      error: error => { this.saving = false; this.error = error?.error?.message || 'Stock could not be adjusted.'; }
    });
  }
  viewHistory(item: StockItem): void { this.historyItem = item; this.movements = []; this.historyLoading = true; this.stock.history(item.inventoryId).subscribe({
    next: value => { this.movements = value; this.historyLoading = false; }, error: () => { this.historyLoading = false; this.error = 'Stock history could not be loaded.'; }
  }); }
  closeHistory(): void { this.historyItem = undefined; this.movements = []; }
  statusLabel(status: string): string { return status.replaceAll('_',' '); }
}
