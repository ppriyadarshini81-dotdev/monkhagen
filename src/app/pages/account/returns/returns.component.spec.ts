import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { AccountService } from '../../../services/account.service';
import { ReturnRequest } from '../../../models/account.model';
import { AccountReturnsComponent } from './returns.component';

describe('AccountReturnsComponent order filter', () => {
  it('allows cancellation while photos await review but prevents cancelling an unconfirmed in-flight creation', () => {
    const account = jasmine.createSpyObj<AccountService>('AccountService', ['getReturns']);
    const component = new AccountReturnsComponent(account, {} as ActivatedRoute);
    const request = { status: 'requested', defectPhotoReviewPending: true, cancellationPending: false, pickupDelayed: false } as ReturnRequest;
    expect(component.canCancelReturn(request)).toBeTrue();
    expect(component.canCancelReturn({ ...request, pickupDelayed: true })).toBeFalse();
  });
  it('shows the requested labels and links each request and its details to the original order', async () => {
    const requests: ReturnRequest[] = (['return', 'replacement', 'defect'] as const).map((requestType, index) => ({
      id: `request-${index}`, orderId: `order-${index}`, orderNumber: `MH-${index}`,
      returnNumber: `R-${index}`, requestType, status: 'return_created', refundAmount: index === 0 ? 1349 : 0,
      requestedAt: '2026-10-12T04:20:00Z', createdAt: '2026-10-12T04:20:00Z', items: [],
      reason: 'size_issue', requestedReplacementSize: null, returnShippingDeduction: index === 0 ? 150 : 0,
      comments: null, refundStatus: 'pending', paymentMethod: 'razorpay', returnAwb: null,
      pickupStatus: null, pickupDelayed: false, cancellationPending: false,
      receivedAt: null, approvedAt: null, rejectedAt: null, refundedAt: null,
      refundDestination: { required: false, provided: false, method: null, masked: null,
        status: null, canEdit: false, transactionReference: null, completedAt: null }
    }));
    const account = jasmine.createSpyObj<AccountService>('AccountService', ['getReturns']);
    account.getReturns.and.returnValue(of(requests));
    await TestBed.configureTestingModule({ imports: [AccountReturnsComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountReturnsComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const headings = Array.from(element.querySelectorAll('.mh-customer-return__head>div>span')).map(item => item.textContent?.trim());
    expect(headings).toEqual(['Return requested', 'Size replacement requested', 'Defective item return requested']);
    expect(element.textContent).not.toContain('Issue report');
    expect(element.querySelector('.mh-customer-return__foot')?.textContent).toContain('1,349.00');
    const links = element.querySelectorAll<HTMLAnchorElement>('.mh-customer-return__head .mh-return-order-link');
    links.forEach((link, index) => {
      expect(link.getAttribute('href')).toBe(`/account/orders?orderId=order-${index}`);
      expect(link.textContent).toBe(`Order #MH-${index}`);
    });
    fixture.componentInstance.openReturnDetails(requests[2]);
    fixture.detectChanges(); await fixture.whenStable();
    expect(element.querySelector('.mh-return-dialog__head .mh-eyebrow')?.textContent).toBe('Defective item return requested');
    expect(element.querySelector('.mh-return-dialog__head .mh-return-order-link')?.getAttribute('href')).toBe('/account/orders?orderId=order-2');
    fixture.componentInstance.closeReturnDetails(); await fixture.whenStable();
    fixture.componentInstance.openReturnDetails(requests[0]); fixture.detectChanges(); await fixture.whenStable();
    expect(element.querySelector('.mh-return-dialog__summary')?.textContent).toContain('1,499.00');
    expect(element.querySelector('.mh-return-dialog__summary')?.textContent).toContain('150.00');
    expect(element.querySelector('.mh-return-dialog__summary')?.textContent).toContain('1,349.00');
    fixture.componentInstance.closeReturnDetails(); fixture.destroy();
  });

  it('keeps order scope across pagination and status changes, and clears it when navigating to all requests', () => {
    const params = new BehaviorSubject(convertToParamMap({ orderId: 'first-order' }));
    const account = jasmine.createSpyObj<AccountService>('AccountService', ['getReturns']);
    account.getReturns.and.returnValue(of([]));
    const component = new AccountReturnsComponent(account, { queryParamMap: params.asObservable() } as ActivatedRoute);
    spyOn(window, 'scrollTo');
    component.ngOnInit(); expect(account.getReturns.calls.mostRecent().args).toEqual([10, 0, '', 'first-order']);
    component.hasNextPage = true; component.changePage(1);
    expect(account.getReturns.calls.mostRecent().args).toEqual([10, 10, '', 'first-order']);
    component.statusFilter = 'open'; component.applyStatusFilter();
    expect(account.getReturns.calls.mostRecent().args).toEqual([10, 0, 'open', 'first-order']);
    params.next(convertToParamMap({ orderId: 'second-order' }));
    expect(account.getReturns.calls.mostRecent().args).toEqual([10, 0, 'open', 'second-order']);
    params.next(convertToParamMap({}));
    expect(account.getReturns.calls.mostRecent().args).toEqual([10, 0, 'open', '']);
    const count = account.getReturns.calls.count(); component.ngOnDestroy();
    params.next(convertToParamMap({ orderId: 'first-order' }));
    expect(account.getReturns.calls.count()).toBe(count);
  });

  it('ignores a previous order response after switching to a different order', () => {
    const params = new BehaviorSubject(convertToParamMap({ orderId: 'first-order' }));
    const first = new Subject<ReturnRequest[]>(), second = new Subject<ReturnRequest[]>();
    const account = jasmine.createSpyObj<AccountService>('AccountService', ['getReturns']);
    account.getReturns.and.returnValues(first, second);
    const component = new AccountReturnsComponent(account, { queryParamMap: params.asObservable() } as ActivatedRoute);
    component.ngOnInit(); params.next(convertToParamMap({ orderId: 'second-order' }));
    const expected = [{ orderId: 'second-order' } as ReturnRequest];
    second.next(expected); first.next([{ orderId: 'first-order' } as ReturnRequest]);
    expect(component.returns).toEqual(expected); component.ngOnDestroy();
  });
});
