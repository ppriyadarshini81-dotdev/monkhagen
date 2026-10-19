import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminComponent } from './pages/admin/admin.component';
import { AdminPortalComponent } from './pages/admin-portal/admin-portal.component';
import { AdminStockComponent } from './pages/admin-stock/admin-stock.component';
import { AdminLedgerComponent } from './pages/admin-ledger/admin-ledger.component';
import { ProductService } from './services/product.service';
import { CategoryService } from './services/category.service';
import { BadgeService } from './services/badge.service';
import { VariantOptionService } from './services/variant-option.service';
import { OrderService } from './services/order.service';
import { UploadService } from './services/upload.service';
import { ShippingService } from './services/shipping.service';
import { ReviewService } from './services/review.service';
import { AuthService } from './services/auth.service';
import { AdminStockService } from './services/admin-stock.service';
import { AdminLedgerService } from './services/admin-ledger.service';

describe('Admin responsive layout in browser viewports', () => {
  const fixtures: ComponentFixture<any>[] = [];
  const frames: HTMLIFrameElement[] = [];
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const name = 'CREAM | Oversized heavyweight unisex cotton T-shirt with a long product name';
  beforeEach(async () => {
    spyOn(AdminComponent.prototype, 'ngOnInit');
    spyOn(AdminStockComponent.prototype, 'ngOnInit');
    spyOn(AdminLedgerComponent.prototype, 'ngOnInit');
    await TestBed.configureTestingModule({ imports: [AdminComponent, AdminPortalComponent, AdminStockComponent, AdminLedgerComponent],
      providers: [provideRouter([]), ...[ProductService, CategoryService, BadgeService, VariantOptionService, OrderService,
        UploadService, ShippingService, ReviewService, AuthService, AdminStockService, AdminLedgerService].map(provide => ({ provide, useValue: {} }))]
    }).compileComponents();
  });
  afterEach(() => { frames.splice(0).forEach(frame => frame.remove()); fixtures.splice(0).forEach(fixture => fixture.destroy()); });

  function create<T>(type: any): ComponentFixture<T> {
    const fixture = TestBed.createComponent<T>(type);
    fixtures.push(fixture);
    return fixture;
  }
  async function viewport(shell: HTMLElement, content: HTMLElement, width: number): Promise<Document> {
    const frame = document.createElement('iframe'); frames.push(frame);
    frame.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;height:900px;border:0`;
    document.body.append(frame);
    const ready = new Promise<void>(resolve => frame.onload = () => resolve());
    const styles = Array.from(document.querySelectorAll('style,link[rel="stylesheet"]')).map(style => style.outerHTML).join('');
    frame.srcdoc = `<html><head><base href="${document.baseURI}">${styles}</head><body></body></html>`;
    await ready;
    const doc = frame.contentDocument!;
    const copy = shell.cloneNode(true) as HTMLElement;
    copy.querySelector('.admin-portal__workspace')!.append(content.cloneNode(true));
    doc.body.append(copy);
    doc.querySelectorAll('details').forEach(details => details.open = true);
    doc.querySelectorAll<HTMLElement>('.admin-record-body,.stock-group .table-wrap').forEach(body => body.hidden = false);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return doc;
  }

  it('keeps customer, status, amount and action columns aligned across rows of different amounts', async () => {
    const shell = create<AdminPortalComponent>(AdminPortalComponent); shell.detectChanges();
    const fixture = create<AdminComponent>(AdminComponent);
    Object.assign(fixture.componentInstance, { tab: 'returns', returnsLoading: false, returns: [1349, 0, 100000, null].map((amount, index) => ({
      id: `return-${index}`, returnNumber: `R-${index}-very-long-reference-123456789`, orderNumber: 'MH-20261012-1234',
      orderId: 'order', requestedAt: '2026-10-12T10:00:00Z', requestType: amount === null ? 'replacement' : 'return',
      status: 'return_created', refundStatus: 'pending', refundAmount: amount || 0,
      customer: { name: 'Priyanka Priyadarshini', email: 'long.customer.email@example.com' }, items: []
    })) });
    fixture.detectChanges();
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      const doc = await viewport(shell.nativeElement, fixture.nativeElement, width);
      for (const selector of ['.admin-record-customer', '.admin-record-status', '.admin-record-amount', '.admin-record-details']) {
        const cells = Array.from(doc.querySelectorAll<HTMLElement>(selector));
        const expected = cells[0].getBoundingClientRect();
        cells.forEach(cell => {
          const rect = cell.getBoundingClientRect();
          expect(Math.abs(rect.left - expected.left)).withContext(`${selector} left at ${width}px`).toBeLessThan(1);
          expect(Math.abs(rect.right - expected.right)).withContext(`${selector} right at ${width}px`).toBeLessThan(1);
        });
      }
      expect(doc.documentElement.scrollWidth).withContext(`returns page overflow at ${width}px`).toBeLessThanOrEqual(width + 1);
    }
  });

  it('contains navigation, expanded filters, management pages and wide tables on phone and tablet', async () => {
    const shell = create<AdminPortalComponent>(AdminPortalComponent); shell.detectChanges();
    const admin = create<AdminComponent>(AdminComponent);
    admin.componentInstance.products = [{ id: 'product', name, images: [pixel], category: name, price: 1499, stock: 25 } as any];
    admin.componentInstance.customerReviews = [{ id: 'review', productName: name, customerName: 'Customer with a long name',
      rating: 5, moderationStatus: 'approved', text: name, images: [], helpfulCount: 0, createdAt: '2026-10-12' } as any];
    const stock = create<AdminStockComponent>(AdminStockComponent); stock.componentInstance.loading = false;
    stock.componentInstance.productGroups = [{ productId:'p', name, imageUrl:pixel, category:name, items: [], units:10000, low:1, out:0, setup:0 }];
    stock.detectChanges();
    const ledger = create<AdminLedgerComponent>(AdminLedgerComponent); ledger.componentInstance.loading = false;
    ledger.componentInstance.data = { transactions: [], summary: { successfulCredits: 1000000, successfulDebits: 0,
      netSuccessfulAmount:1000000, pendingRefunds:0, failedTransactionCount:0 }, pagination: {page:1,pageSize:25,total:0,pages:1} };
    ledger.detectChanges();
    for (const width of [320, 390, 768, 1024, 1200]) {
      for (const tab of ['orders','returns','reviews','products','categories','badges','sizes','colors']) {
        admin.componentInstance.tab = tab as any; admin.detectChanges();
        const doc = await viewport(shell.nativeElement, admin.nativeElement, width);
        expect(doc.documentElement.scrollWidth).withContext(`${tab} overflow at ${width}px`).toBeLessThanOrEqual(width + 1);
      }
      for (const [label, fixture] of [['stock',stock],['ledger',ledger]] as const) {
        const doc = await viewport(shell.nativeElement, fixture.nativeElement, width);
        expect(doc.documentElement.scrollWidth).withContext(`${label} overflow at ${width}px`).toBeLessThanOrEqual(width + 1);
      }
    }
  }, 20000);
});
