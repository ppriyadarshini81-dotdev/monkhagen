import { fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { LedgerResponse } from '../../models/ledger.model';
import { AdminLedgerService } from '../../services/admin-ledger.service';
import { AdminLedgerComponent } from './admin-ledger.component';

describe('AdminLedgerComponent', () => {
  const response: LedgerResponse = {
    transactions: [], pagination: { page: 1, pageSize: 25, total: 0, pages: 1 },
    summary: { successfulCredits: 1299, successfulDebits: 500, netSuccessfulAmount: 799, pendingRefunds: 250, failedTransactionCount: 1 }
  };

  function setup(): { component: AdminLedgerComponent; service: jasmine.SpyObj<AdminLedgerService> } {
    const service = jasmine.createSpyObj<AdminLedgerService>('AdminLedgerService', ['list', 'detail', 'export']);
    service.list.and.returnValue(of(response));
    const component = new AdminLedgerComponent(service);
    return { component, service };
  }

  it('loads server results and keeps pagination/sorting on the API request', () => {
    const { component, service } = setup();
    component.ngOnInit();
    expect(component.data).toBe(response);
    component.sort('amount');
    expect(component.filters.sortBy).toBe('amount');
    expect(component.filters.sortDirection).toBe('desc');
    expect(service.list.calls.mostRecent().args[0]).toEqual(component.filters);
    component.ngOnDestroy();
  });

  it('debounces search and rejects an inverted date range locally', fakeAsync(() => {
    const { component, service } = setup();
    component.ngOnInit();
    component.searchText = 'MH-2026'; component.search(); tick(349);
    expect(service.list).toHaveBeenCalledTimes(1);
    tick(1); expect(service.list).toHaveBeenCalledTimes(2);
    expect(component.filters.search).toBe('MH-2026');
    component.filters.dateFrom = '2026-10-31'; component.filters.dateTo = '2026-10-01';
    component.applyFilters();
    expect(component.error).toContain('start date');
    expect(service.list).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  }));
});
