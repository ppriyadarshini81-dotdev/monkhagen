import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { Subject, throwError } from 'rxjs';
import { Order } from '../../services/order.service';
import { ShippingService } from '../../services/shipping.service';
import { AdminComponent } from './admin.component';

describe('AdminComponent invoices', () => {
  let shipping: jasmine.SpyObj<ShippingService>;
  let component: AdminComponent;
  let anchorClick: jasmine.Spy;
  const order = { id: 'order-1', orderNumber: 'MH-1', shipment: { shiprocketOrderId: 101 } } as Order;

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

  it('shows a friendly provider error and ignores orders without a Shiprocket mapping', () => {
    shipping.getInvoice.and.returnValue(throwError(() => new Error('private provider response')));
    component.downloadInvoice(order);
    expect(component.invoiceError).toBe('Invoice is not available yet. Please try again later.');
    expect(window.open).not.toHaveBeenCalled();
    component.downloadInvoice({ ...order, shipment: { ...order.shipment!, shiprocketOrderId: null } });
    expect(shipping.getInvoice).toHaveBeenCalledTimes(1);
  });
});
