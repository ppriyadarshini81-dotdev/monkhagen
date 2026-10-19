import { of } from 'rxjs';
import { AdminComponent } from './admin.component';

describe('Admin list filters and pagination', () => {
  let component: AdminComponent;
  let orders: any;
  beforeEach(() => {
    orders = jasmine.createSpyObj('OrderService', ['allOrders','adminReturns','adminAfterSalesOrders']);
    orders.allOrders.and.returnValue(of(Array.from({ length: 11 }, (_, index) => ({ id: `order-${index}` }))));
    orders.adminReturns.and.returnValue(of(Array.from({ length: 11 }, (_, index) => ({ id: `return-${index}` }))));
    orders.adminAfterSalesOrders.and.returnValue(of([]));
    component = new AdminComponent({} as never, {} as never, {} as never, {} as never, orders,
      {} as never, {} as never, {} as never, {} as never);
  });

  it('applies filters before paginating, retains applied filters and resets to page one', () => {
    component.ordersPage = 4;
    component.orderSearch = ' older order ';
    component.orderCriteria.paymentStatus = 'paid';
    component.applyOrderFilters('delivered');
    expect(orders.allOrders).toHaveBeenCalledWith(jasmine.objectContaining({ search: 'older order', paymentStatus: 'paid', fulfillment: 'delivered' }), 11, 0);
    expect(component.orders.length).toBe(10);
    expect(component.ordersHasNext).toBeTrue();
    component.orderSearch = 'unapplied search';
    component.changeOrdersPage(1);
    expect(orders.allOrders.calls.mostRecent().args).toEqual([jasmine.objectContaining({ search: 'older order' }), 11, 10]);
    component.clearOrderFilters();
    expect(component.ordersPage).toBe(0);
    expect(component.orderFilter).toBe('all');
    expect(component.orderSearch).toBe('');
  });

  it('does not fetch invalid date ranges and blocks next on the last page', () => {
    component.orderCriteria = { from: '2026-10-20', to: '2026-10-01' };
    component.applyOrderFilters();
    expect(orders.allOrders).not.toHaveBeenCalled();
    expect(component.ordersError).toContain('From date');
    component.changeOrdersPage(1);
    expect(component.ordersPage).toBe(0);
  });

  it('starts rows collapsed and expands each order, return and outbound record independently', () => {
    expect(component.isAdminRowExpanded('order', 'same-id')).toBeFalse();
    component.toggleAdminRow('order', 'same-id');
    expect(component.isAdminRowExpanded('order', 'same-id')).toBeTrue();
    expect(component.isAdminRowExpanded('return', 'same-id')).toBeFalse();
    expect(component.isAdminRowExpanded('outbound', 'same-id')).toBeFalse();
    component.toggleAdminRow('return', 'return-1');
    expect(component.isAdminRowExpanded('return', 'return-1')).toBeTrue();
    component.toggleAdminRow('order', 'same-id');
    expect(component.isAdminRowExpanded('order', 'same-id')).toBeFalse();
    expect(component.isAdminRowExpanded('return', 'return-1')).toBeTrue();
  });

  it('loads new orders for today and tomorrow in India time and clears the shortcut when changing presets', () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-10-19T12:00:00Z'));
    try {
      component.orderSearch = 'old search';
      component.selectOrderPreset('new');
      expect(component.orderFilter).toBe('new');
      expect(component.orderSearch).toBe('');
      expect(orders.allOrders).toHaveBeenCalledWith(jasmine.objectContaining({from:'2026-10-19',to:'2026-10-20',fulfillment:'all'}),11,0);
      component.selectOrderPreset('all');
      expect(orders.allOrders.calls.mostRecent().args[0].from).toBe('');
      expect(orders.allOrders.calls.mostRecent().args[0].to).toBe('');
    } finally { jasmine.clock().uninstall(); }
  });

  it('loads new returns with the same date window and server-side pagination', () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-10-19T18:30:00Z'));
    try {
      component.selectReturnTab('new');
      expect(orders.adminReturns).toHaveBeenCalledWith('all',11,0,jasmine.objectContaining({from:'2026-10-20',to:'2026-10-21'}));
      component.changeReturnsPage(1);
      expect(orders.adminReturns.calls.mostRecent().args[2]).toBe(10);
      component.selectReturnTab('all');
      expect(orders.adminReturns.calls.mostRecent().args[3].from).toBe('');
    } finally { jasmine.clock().uninstall(); }
  });

  it('filters returns across workflow pages and resets incompatible outbound filters', () => {
    component.returnCriteria = { search: 'customer', requestType: 'replacement', status: 'received' };
    component.applyReturnFilters();
    expect(orders.adminReturns).toHaveBeenCalledWith('all', 11, 0, jasmine.objectContaining({ requestType: 'replacement', status: 'received' }));
    component.changeReturnsPage(1);
    expect(orders.adminReturns.calls.mostRecent().args[2]).toBe(10);
    component.selectReturnTab('outbound_orders');
    expect(orders.adminAfterSalesOrders).toHaveBeenCalledWith(11, 0, jasmine.objectContaining({ search: 'customer', requestType: '', status: '' }));
    expect(component.returnsPage).toBe(0);
  });
});
