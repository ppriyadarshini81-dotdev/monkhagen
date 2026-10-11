import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { Subject, throwError } from 'rxjs';
import { Order } from '../../services/order.service';
import { ShippingService } from '../../services/shipping.service';
import { AdminComponent } from './admin.component';

describe('AdminComponent invoices', () => {
  let shipping: jasmine.SpyObj<ShippingService>;
  let component: AdminComponent;
  let anchorClick: jasmine.Spy;
  const order = { id: 'order-1', orderNumber: 'MH-1', shipment:{shiprocketOrderId:101} } as Order;

  beforeEach(() => {
    shipping = jasmine.createSpyObj<ShippingService>('ShippingService', ['createShipment', 'getInvoice']);
    component = new AdminComponent({} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, shipping, {} as never, {} as never);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:invoice');
    spyOn(URL, 'revokeObjectURL');
    anchorClick = spyOn(HTMLAnchorElement.prototype, 'click');
    spyOn(window, 'open');
  });

  it('downloads an eligible admin invoice in the same tab and prevents duplicate clicks', () => {
    const response = new Subject<HttpResponse<Blob>>();
    shipping.getInvoice.and.returnValue(response);
    component.downloadInvoice(order);
    component.downloadInvoice(order);
    expect(shipping.getInvoice).toHaveBeenCalledOnceWith('order-1');
    expect(component.invoiceBusyOrderId).toBe('order-1');
    response.next(new HttpResponse({
      body: new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }),
      headers: new HttpHeaders({ 'Content-Disposition': 'attachment; filename="MH-1_Invoice_101.pdf"' })
    }));
    expect(anchorClick).toHaveBeenCalled();
    expect((anchorClick.calls.mostRecent().object as HTMLAnchorElement).download).toBe('MH-1_Invoice_101.pdf');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('shows a friendly invoice error and ignores orders without a Shiprocket mapping', () => {
    shipping.getInvoice.and.returnValue(throwError(() => new Error('private provider response')));
    component.downloadInvoice(order);
    expect(component.invoiceError).toBe('Invoice is not available yet. Please try again later.');
    expect(window.open).not.toHaveBeenCalled();
    component.downloadInvoice({ ...order, shipment:undefined });
    expect(shipping.getInvoice).toHaveBeenCalledTimes(1);
  });
  it('downloads the COD invoice without initiating shipment creation',()=>{
    shipping.getInvoice.and.returnValue(new Subject<HttpResponse<Blob>>());
    component.downloadInvoice({...order,paymentMethod:'cod',paymentStatus:'pending'});
    expect(shipping.getInvoice).toHaveBeenCalledOnceWith('order-1');expect(shipping.createShipment).not.toHaveBeenCalled();
  });

  it('allows the administrator to create a shipment for a paid order without a pending operation', () => {
    const ready = { ...order, paymentStatus: 'paid', shipment: { shippingStatus: 'pending',
      lastErrorCode: null, pendingOperation: null } } as Order;
    shipping.createShipment.and.returnValue(new Subject());
    expect(component.canRetryShipment(ready)).toBeTrue();
    component.retryShipment(ready);
    expect(shipping.createShipment).toHaveBeenCalledOnceWith(ready.id);
  });

  it('blocks creation while an earlier shipping operation requires reconciliation', () => {
    const pending = { ...order, paymentStatus: 'paid', shipment: { pendingOperation: 'create' } } as Order;
    expect(component.canRetryShipment(pending)).toBeFalse();
  });
});
