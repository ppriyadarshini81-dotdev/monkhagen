import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { Order } from '../../../models/account.model';
import { AccountService } from '../../../services/account.service';
import { AccountOrdersComponent } from './orders.component';

describe('AccountOrdersComponent', () => {
  let account: jasmine.SpyObj<AccountService>;
  let component: AccountOrdersComponent;
  let anchorClick: jasmine.Spy;

  const order = { id: 'order-1', orderNumber: 'MH-1', invoiceAvailable: true } as Order;

  beforeEach(() => {
    account = jasmine.createSpyObj<AccountService>('AccountService',
      ['getOrders', 'getTracking', 'getInvoice', 'getReturnEligibility', 'createReturn']);
    account.getOrders.and.returnValue(of([]));
    component = new AccountOrdersComponent(account);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:invoice');
    spyOn(URL, 'revokeObjectURL');
    anchorClick = spyOn(HTMLAnchorElement.prototype, 'click');
    spyOn(window, 'open');
  });

  it('downloads the customer invoice in the same tab and prevents duplicate requests', () => {
    const response = new Subject<HttpResponse<Blob>>();
    account.getInvoice.and.returnValue(response);
    component.downloadInvoice(order);
    component.downloadInvoice(order);
    expect(account.getInvoice).toHaveBeenCalledOnceWith('order-1');
    expect(component.invoiceLoadingOrderId).toBe('order-1');
    response.next(new HttpResponse({
      body: new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }),
      headers: new HttpHeaders({ 'Content-Disposition': 'attachment; filename="MH-1_Invoice_101.pdf"' })
    }));
    expect(anchorClick).toHaveBeenCalled();
    expect((anchorClick.calls.mostRecent().object as HTMLAnchorElement).download).toBe('MH-1_Invoice_101.pdf');
    expect(window.open).not.toHaveBeenCalled();
    expect(component.invoiceLoadingOrderId).toBe('');
  });

  it('shows a friendly error and does not request invoices without a mapping', () => {
    account.getInvoice.and.returnValue(throwError(() => new Error('provider secret')));
    component.downloadInvoice(order);
    expect(component.invoiceError).toBe('Invoice is not available yet. Please try again later.');
    expect(window.open).not.toHaveBeenCalled();
    component.downloadInvoice({ ...order, invoiceAvailable: false });
    expect(account.getInvoice).toHaveBeenCalledTimes(1);
  });

  it('keeps return reasons and submission state after the order-details dialog closes', () => {
    component.returnEligibility = {
      orderId: order.id, eligible: true, reason: null, message: null, returnUntil: new Date().toISOString(),
      reasons: [{ code: 'size_issue', label: 'Size issue' }],
      items: [{ orderItemId: 'item-1', productName: 'Test tee', sku: 'TEE-1', size: 'M', color: 'Black',
        purchasedQuantity: 1, returnedQuantity: 0, remainingQuantity: 1 }]
    };
    component.openReturn(order);
    component.clearDetails();

    expect(component.returnReasons).toEqual([{ code: 'size_issue', label: 'Size issue' }]);
    component.returnRows[0].selected = true;
    component.returnRows[0].reason = 'size_issue';
    account.createReturn.and.returnValue(of({ pickupDelayed: false } as any));
    component.submitReturn();

    expect(account.createReturn).toHaveBeenCalled();
  });
});
