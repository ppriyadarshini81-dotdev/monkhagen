import { fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminStockComponent } from './admin-stock.component';

describe('AdminStockComponent', () => {
  const item: any = { inventoryId: 'inventory-1', productId: 'product-1', productName: 'Test Tee',
    productSlug: 'test-tee', categoryId: 'category-1', category: 'Tees', sizeId: 'size-m', size: 'M',
    currentStock: 2, initialStock: 10, threshold: 2, configured: true, remainingPercent: 20,
    status: 'LOW_STOCK', updatedAt: new Date().toISOString() };
  const response: any = { items: [item], summary: { totalProducts: 1, totalUnits: 2, lowStockSizes: 1,
    outOfStockSizes: 0, setupRequiredSizes: 0 }, pagination: { page: 1, limit: 25, total: 1, pages: 1 } };
  let stock: any;
  let component: AdminStockComponent;

  beforeEach(() => {
    stock = { list: jasmine.createSpy().and.returnValue(of(response)),
      adjust: jasmine.createSpy().and.returnValue(of({})), history: jasmine.createSpy().and.returnValue(of([])) };
    component = new AdminStockComponent(stock,
      { getAdminCategories: () => of([]) } as any,
      { getAdminOptions: () => of([]) } as any);
  });

  it('loads size-level stock and sends combined filters', () => {
    component.ngOnInit();
    component.filters.status = 'LOW_STOCK';
    component.filters.size = 'size-m';
    component.filterChanged();
    expect(stock.list).toHaveBeenCalledWith(jasmine.objectContaining({ page: 1, status: 'LOW_STOCK', size: 'size-m' }));
    expect(component.data?.items[0].size).toBe('M');
  });

  it('groups interleaved sizes by product, sorts sizes and totals their stock issues', () => {
    stock.list.and.returnValue(of({ ...response, items: [
      { ...item, size: 'XL', currentStock: 8, status: 'IN_STOCK' },
      { ...item, productId: 'product-2', productName: 'Other Tee', status: 'OUT_OF_STOCK', currentStock: 0 },
      { ...item, size: 'S' },
      { ...item, size: 'L', configured: false, currentStock: 100, status: 'SETUP_REQUIRED' }
    ] }));
    component.load();
    expect(component.productGroups.length).toBe(2);
    const group = component.productGroups[0];
    expect(group.items.map(size => size.size)).toEqual(['S', 'L', 'XL']);
    expect(group.units).toBe(10);
    expect(group.low).toBe(1);
    expect(group.setup).toBe(1);
    expect(component.isExpanded(group.productId)).toBeFalse();
    component.toggleProduct(group.productId);
    expect(component.isExpanded(group.productId)).toBeTrue();
    expect(component.isExpanded('product-2')).toBeFalse();
    component.load();
    expect(component.isExpanded(group.productId)).toBeTrue();
    component.openAdjust(group.items[0]);
    expect(component.selected?.size).toBe('S');
    component.toggleProduct(group.productId);
    expect(component.isExpanded(group.productId)).toBeFalse();
  });

  it('debounces product search and resets pagination', fakeAsync(() => {
    component.ngOnInit();
    component.filters.page = 3;
    component.search('  test tee  ');
    tick(350);
    expect(component.filters.search).toBe('test tee');
    expect(component.filters.page).toBe(1);
  }));

  it('prevents negative results and records a reason for a valid adjustment', () => {
    component.openAdjust(item);
    component.adjustment = -3;
    component.reason = 'Damaged';
    component.saveAdjustment();
    expect(stock.adjust).not.toHaveBeenCalled();
    expect(component.error).toContain('zero or above');

    component.adjustment = 5;
    component.reason = 'New delivery';
    component.saveAdjustment();
    expect(stock.adjust).toHaveBeenCalledWith('inventory-1', 5, 'New delivery');
    expect(component.selected).toBeUndefined();
  });
});
