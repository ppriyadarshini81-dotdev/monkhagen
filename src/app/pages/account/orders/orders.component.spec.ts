import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { CancellationEligibility, Order, ReturnEligibility } from '../../../models/account.model';
import { AccountService } from '../../../services/account.service';
import { AccountOrdersComponent } from './orders.component';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

describe('AccountOrdersComponent', () => {
  let account: jasmine.SpyObj<AccountService>;
  let component: AccountOrdersComponent;
  let anchorClick: jasmine.Spy;

  const order = { id: 'order-1', orderNumber: 'MH-1', invoiceAvailable: true,items:[] } as unknown as Order;

  function productEligibility(blockFirst = false): ReturnEligibility {
    return { orderId: order.id, eligible: true, hasExistingRequest: blockFirst, reason: null, message: null,
      returnUntil: new Date().toISOString(), reasons: [],
      requestTypes: ['return', 'replacement', 'defect'].map(code => ({ code: code as 'return' | 'replacement' | 'defect',
        label: code, eligible: true, message: '' })),
      items: [1, 2, 3].map(index => ({ orderItemId: `item-${index}`, productName: `Tee ${index}`, sku: null,
        size: 'M', color: 'Black', purchasedQuantity: 2, returnedQuantity: index === 1 && blockFirst ? 2 : 0,
        remainingQuantity: index === 1 && blockFirst ? 0 : 2, alreadyRequested: index === 1 && blockFirst,
        replacementSizes: ['M', 'L'] })) };
  }

  async function renderValidation(fixture: ComponentFixture<AccountOrdersComponent>): Promise<void> {
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 50));
    await fixture.whenStable(); fixture.detectChanges();
  }

  beforeEach(() => {
    account = jasmine.createSpyObj<AccountService>('AccountService',
      ['getOrders', 'getOrder', 'getTracking', 'getInvoice', 'getReturnEligibility', 'getCancellationEligibility', 'createReturn', 'uploadDefectPhotos']);
    account.getOrders.and.returnValue(of([]));
    component = new AccountOrdersComponent(account, { queryParamMap: of(convertToParamMap({})) } as ActivatedRoute);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:invoice');
    spyOn(URL, 'revokeObjectURL');
    anchorClick = spyOn(HTMLAnchorElement.prototype, 'click');
    spyOn(window, 'open');
  });

  it('opens a linked original order even when it is outside the current orders page', async () => {
    const linkedOrder = { ...order, status: 'confirmed', paymentStatus: 'paid', paymentMethod: 'razorpay',
      createdAt: '2026-10-01T00:00:00Z', totalAmount: 1499, subtotal: 1499, shippingAmount: 0 } as Order;
    account.getOrder.and.returnValue(of(linkedOrder));
    account.getReturnEligibility.and.returnValue(of(productEligibility()));
    account.getCancellationEligibility.and.returnValue(of({ eligible: false } as CancellationEligibility));
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent], providers: [
      { provide: AccountService, useValue: account }, provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ orderId: order.id })) } }
    ] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(account.getOrder).toHaveBeenCalledOnceWith(order.id);
    expect(fixture.componentInstance.orders).toEqual([]);
    expect(fixture.componentInstance.selectedOrder).toEqual(linkedOrder);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLDialogElement>('.mh-order-details-dialog')?.open).toBeTrue();
    expect(element.querySelector('#order-details-title')?.textContent).toBe('#MH-1');
    fixture.componentInstance.closeDetails(); fixture.destroy();
  });

  it('ignores stale linked orders, handles unavailable orders and stops listening after leaving', () => {
    const params = new BehaviorSubject(convertToParamMap({ orderId: 'old-order' }));
    const oldOrder = new Subject<Order>();
    account.getOrder.and.returnValues(oldOrder, of(order), throwError(() => new Error('private provider details')));
    component = new AccountOrdersComponent(account, { queryParamMap: params.asObservable() } as ActivatedRoute);
    const openDetails = spyOn(component, 'openDetails');
    component.ngOnInit();
    params.next(convertToParamMap({ orderId: order.id }));
    oldOrder.next({ ...order, id: 'old-order' });
    expect(openDetails).toHaveBeenCalledOnceWith(order);
    params.next(convertToParamMap({ orderId: 'unavailable-order' }));
    expect(component.linkedOrderError).toBe('We could not open this order. Please try again.');
    expect(component.loadError).toBe('');
    params.next(convertToParamMap({}));
    expect(component.linkedOrderError).toBe('');
    expect(account.getOrder).toHaveBeenCalledTimes(3);
    component.ngOnDestroy(); params.next(convertToParamMap({ orderId: 'another-order' }));
    expect(account.getOrder).toHaveBeenCalledTimes(3);
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

  it('changes date ordering from the menu, resets pagination and keeps the status filter', async () => {
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(account.getOrders).toHaveBeenCalledWith(10, 0, '', 'newest', '', '');
    fixture.componentInstance.page = 3;
    fixture.componentInstance.statusFilter = 'delivered';
    const select = (fixture.nativeElement as HTMLElement).querySelectorAll('select')[1];
    select.value = 'oldest';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(account.getOrders.calls.mostRecent().args).toEqual([10, 0, 'delivered', 'oldest', '', '']);
    expect(fixture.componentInstance.page).toBe(0);
    fixture.componentInstance.hasNextPage = true;
    spyOn(window, 'scrollTo');
    fixture.componentInstance.changePage(1);
    expect(account.getOrders.calls.mostRecent().args).toEqual([10, 10, 'delivered', 'oldest', '', '']);
    fixture.destroy();
  });

  it('applies dates from the form, retains them across pages and clears only the date range', async () => {
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const instance = fixture.componentInstance;
    instance.page = 3; instance.statusFilter = 'active'; instance.dateSort = 'oldest';
    const element = fixture.nativeElement as HTMLElement;
    const from = element.querySelector<HTMLInputElement>('input[name="dateFrom"]')!;
    const to = element.querySelector<HTMLInputElement>('input[name="dateTo"]')!;
    from.value = '2026-10-01'; from.dispatchEvent(new Event('input'));
    to.value = '2026-10-11'; to.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges(); await fixture.whenStable();
    expect(account.getOrders.calls.mostRecent().args).toEqual([10, 0, 'active', 'oldest', '2026-10-01', '2026-10-11']);
    instance.hasNextPage = true; spyOn(window, 'scrollTo'); instance.changePage(1);
    expect(account.getOrders.calls.mostRecent().args).toEqual([10, 10, 'active', 'oldest', '2026-10-01', '2026-10-11']);
    const clear = Array.from(element.querySelectorAll('button')).find(button => button.textContent?.includes('Clear dates'))!;
    clear.click();
    expect(account.getOrders.calls.mostRecent().args).toEqual([10, 0, 'active', 'oldest', '', '']);
    expect(instance.dateFrom).toBe(''); expect(instance.dateTo).toBe('');
    fixture.destroy();
  });

  it('rejects a reversed date range without replacing the currently applied filters', () => {
    component.loading = false;
    component.dateRange = { from: '2026-10-01', to: '2026-10-05' };
    component.dateFrom = '2026-10-11'; component.dateTo = '2026-10-01';
    component.applyDateRange();
    expect(account.getOrders).not.toHaveBeenCalled();
    expect(component.dateRangeError).toContain('From date');
    expect(component.dateRange).toEqual({ from: '2026-10-01', to: '2026-10-05' });
  });

  it('shows a friendly error and does not request invoices without a mapping', () => {
    account.getInvoice.and.returnValue(throwError(() => new Error('provider secret')));
    component.downloadInvoice(order);
    expect(component.invoiceError).toBe('Invoice is not available yet. Please try again later.');
    expect(window.open).not.toHaveBeenCalled();
    component.downloadInvoice({ ...order, invoiceAvailable: false });
    expect(account.getInvoice).toHaveBeenCalledTimes(1);
  });

  it('uses product cards for returns, blocks requested products, and moves selections above other products and reasons', async () => {
    account.createReturn.and.returnValue(new Subject());
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent);
    fixture.detectChanges();
    const instance = fixture.componentInstance;
    instance.returnEligibility = productEligibility(true);
    instance.openReturn(order, 'return');
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(instance.canRequestReturn(order)).toBeTrue();
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>('dialog[aria-labelledby="return-title"]')!;
    const requested = form.querySelector<HTMLButtonElement>('[data-order-item="item-1"] .mh-replacement-product')!;
    expect(requested.disabled).toBeTrue(); expect(requested.textContent).toContain('Already requested');
    requested.click(); expect(instance.returnRows[0].selected).toBeFalse();
    form.querySelector<HTMLButtonElement>('[data-order-item="item-3"] .mh-replacement-product')!.click();
    fixture.detectChanges();
    expect(form.querySelector('.mh-replacement-item')?.getAttribute('data-order-item')).toBe('item-3');
    expect(form.querySelector('.mh-replacement-sizes')).toBeNull();
    expect(form.querySelectorAll('.mh-return-reason-card').length).toBe(2);
    expect(form.querySelector('[data-reason-group="quality"]')).toBeNull();
    expect(form.querySelector('[data-reason-group="different"]')).toBeNull();
    form.querySelector<HTMLButtonElement>('[data-reason-group="mind"] button')!.click(); fixture.detectChanges();
    expect(form.querySelector('.mh-return-reason-card')?.getAttribute('data-reason-group')).toBe('mind');
    const radios = form.querySelectorAll<HTMLInputElement>('[data-reason-group="mind"] input[type="radio"]');
    expect(radios.length).toBe(2);
    expect(Array.from(form.querySelectorAll('[data-reason-group="mind"] .mh-return-reason-options label')).map(label => label.textContent?.trim()))
      .toEqual(['Delivery was delayed', 'I do not need it anymore']);
    radios[1].click(); fixture.detectChanges();
    expect(form.querySelector('.mh-return-selected-reason')?.textContent).toContain('I do not need it anymore');
    expect(form.querySelector('[data-reason-group="mind"] .mh-return-reason-options label')?.textContent).toContain('I do not need it anymore');
    instance.returnRows[2].quantity = 2;
    instance.submitReturn();
    expect(account.createReturn.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ requestType: 'return',
      items: [{ orderItemId: 'item-3', quantity: 2, reason: 'changed_mind', comments: 'I do not need it anymore' }] }));
    fixture.destroy();
  });

  it('preserves Return Item for changed-mind and fit reasons and blocks different-product selection', () => {
    component.returnEligibility = productEligibility(); component.openReturn(order, 'return');
    const [different, fit] = component.returnRows;
    component.selectReplacementItem(different); component.selectReplacementItem(fit);
    component.selectReturnReason(different, component.returnReasonGroups[3], component.returnReasonGroups[3].options[0]);
    expect(different.reason).toBe('');
    component.selectReturnReason(different, component.returnReasonGroups[2], component.returnReasonGroups[2].options[0]);
    component.selectReturnReason(fit, component.returnReasonGroups[1], component.returnReasonGroups[1].options[0]);
    account.createReturn.and.returnValue(new Subject()); component.submitReturn();
    expect(account.createReturn.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ requestType: 'return',
      items: [{ orderItemId: 'item-1', quantity: 1, reason: 'changed_mind', comments: 'Delivery was delayed' },
        { orderItemId: 'item-2', quantity: 1, reason: 'size_issue', comments: 'Size too small' }] }));
  });

  it('preserves the defective-item option for the same quality reason', () => {
    component.returnEligibility = productEligibility(); component.openReturn(order, 'defect');
    const row = component.returnRows[0]; component.selectReplacementItem(row);
    component.selectReturnReason(row, component.returnReasonGroups[0], component.returnReasonGroups[0].options[0]);
    component.defectPhotosByItem[row.orderItemId] = [{ file: new File(['photo'], 'item.png', { type: 'image/png' }), preview: 'blob:photo' }, null];
    component.defectDisclaimerAccepted = true;
    account.uploadDefectPhotos.and.returnValue(of([{ id: 'photo-1', url: 'https://media.example/photo.png' }]));
    account.createReturn.and.returnValue(new Subject()); component.submitReturn();
    expect(account.createReturn.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ requestType: 'defect',
      items: [{ orderItemId: 'item-1', quantity: 1, reason: 'quality_issue', comments: 'Received a poor quality product', photoIds: ['photo-1'] }] }));
  });

  it('requires photo 1, offers two slots, uploads selected photos before submission and keeps the refund free of shipping deduction', async () => {
    account.createReturn.and.returnValue(new Subject());
    account.uploadDefectPhotos.and.returnValue(of([{ id: 'photo-1', url: 'https://media.example/one.png' }, { id: 'photo-2', url: 'https://media.example/two.png' }]));
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent); fixture.detectChanges();
    const instance = fixture.componentInstance;
    const eligibility = productEligibility(); eligibility.items[0].refundableUnitAmounts = [1499, 1499];
    instance.returnEligibility = eligibility; instance.openReturn(order, 'defect');
    instance.defectDisclaimerAccepted = true;
    const row = instance.returnRows[0]; instance.selectReplacementItem(row);
    instance.selectReturnReason(row, instance.returnReasonGroups[0], instance.returnReasonGroups[0].options[0]);
    fixture.detectChanges();
    const inputs = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('.mh-defect-photo-upload input[type="file"]');
    expect(inputs.length).toBe(2);
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.mh-return-reason-card')).map(card => card.getAttribute('data-reason-group')))
      .toEqual(['quality', 'different']);
    instance.continueReturn(); expect(instance.returnStep).toBe('items');
    fixture.detectChanges();
    expect(instance.returnError).toBe('');
    expect(inputs[0].getAttribute('aria-invalid')).toBe('true');
    expect(inputs[1].getAttribute('aria-invalid')).toBe('false');
    expect(inputs[0].closest('.mh-field-invalid')?.textContent).toContain('Upload item photo 1 showing the issue.');
    const files = [new File(['one'], 'one.png', { type: 'image/png' }), new File(['two'], 'two.png', { type: 'image/png' })];
    const second = new DataTransfer(); second.items.add(files[1]); inputs[1].files = second.files; inputs[1].dispatchEvent(new Event('change'));
    instance.continueReturn(); expect(instance.returnStep).toBe('items');
    const first = new DataTransfer(); first.items.add(files[0]); inputs[0].files = first.files; inputs[0].dispatchEvent(new Event('change'));
    instance.continueReturn(); expect(instance.returnStep).toBe('refund');
    expect(instance.returnRefundDeduction()).toBe(0); expect(instance.returnRefundNet()).toBe(1499);
    instance.submitReturn();
    expect(account.uploadDefectPhotos).toHaveBeenCalledOnceWith(order.id, 'item-1', files);
    expect(account.createReturn.calls.mostRecent().args[0].items[0].photoIds).toEqual(['photo-1','photo-2']);
    fixture.destroy(); expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('reviews the exact discounted refund and original payment method before creating a return', async () => {
    account.createReturn.and.returnValue(new Subject());
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent); fixture.detectChanges();
    const instance = fixture.componentInstance;
    const eligibility = productEligibility(); eligibility.shippingDeductionAmount = 150;
    eligibility.items[0].refundableUnitAmounts = [1499, 1498.99];
    instance.returnEligibility = eligibility;
    instance.openReturn({ ...order, paymentMethod: 'razorpay' }, 'return');
    const row = instance.returnRows[0]; instance.selectReplacementItem(row);
    instance.selectReturnReason(row, instance.returnReasonGroups[1], instance.returnReasonGroups[1].options[0]);
    instance.continueReturn(); fixture.detectChanges(); await fixture.whenStable();
    expect(account.createReturn).not.toHaveBeenCalled();
    expect(instance.returnStep).toBe('refund');
    expect(instance.returnRefundGross()).toBe(1499); expect(instance.returnRefundNet()).toBe(1349);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.mh-refund-review')?.textContent).toContain('1,349.00');
    expect(element.querySelector('.mh-refund-review')?.textContent).toContain('original payment method');
    expect(element.querySelector('.mh-refund-destination')).toBeNull();
    instance.backToReturnItems(); expect(row.selected).toBeTrue();
    row.quantity = 2; instance.continueReturn();
    expect(instance.returnRefundNet()).toBe(2847.99);
    instance.submitReturn();
    expect(account.createReturn.calls.mostRecent().args[0].refundDestination).toBeUndefined();
    fixture.destroy();
  });

  it('collects matching COD UPI details before submission and clears them on closing', () => {
    const eligibility = productEligibility(); eligibility.items[0].refundableUnitAmounts = [1499, 1499];
    component.returnEligibility = eligibility; component.openReturn({ ...order, paymentMethod: 'cod' }, 'return');
    const row = component.returnRows[0]; component.selectReplacementItem(row);
    component.selectReturnReason(row, component.returnReasonGroups[1], component.returnReasonGroups[1].options[0]);
    component.continueReturn(); component.submitReturn();
    expect(account.createReturn).not.toHaveBeenCalled();
    expect(component.refundFieldError('upi')).toBe('Enter your UPI ID.');
    expect(component.refundFieldError('upiConfirm')).toBe('Confirm your UPI ID.');
    expect(component.returnError).toBe('');
    component.refundUpi = 'buyer@bank'; component.refundUpiConfirm = 'different@bank'; component.submitReturn();
    expect(account.createReturn).not.toHaveBeenCalled();
    expect(component.refundFieldError('upi')).toBe('');
    expect(component.refundFieldError('upiConfirm')).toBe('UPI IDs must match.');
    component.refundUpiConfirm = 'buyer@bank'; account.createReturn.and.returnValue(new Subject()); component.submitReturn();
    expect(account.createReturn.calls.mostRecent().args[0].refundDestination).toEqual({ method: 'UPI', upiId: 'buyer@bank', confirmUpiId: 'buyer@bank' });
    component.clearReturn(); expect(component.refundUpi).toBe(''); expect(component.refundUpiConfirm).toBe('');
  });

  it('highlights and shakes missing product, quantity, reason and size fields locally in all three request flows', async () => {
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    for (const type of ['return', 'replacement', 'defect'] as const) {
      const fixture = TestBed.createComponent(AccountOrdersComponent); fixture.detectChanges();
      const instance = fixture.componentInstance;
      instance.returnEligibility = productEligibility(); instance.openReturn(order, type);
      fixture.detectChanges(); await fixture.whenStable();
      const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>('dialog[aria-labelledby="return-title"]')!;
      instance.continueReturn(); await renderValidation(fixture);
      expect(form.querySelector('.mh-return-selection.mh-field-invalid.mh-validation-shake')?.textContent).toContain('Select at least one item.');
      expect(form.querySelector('.mh-tracking-error')).toBeNull();
      const row = instance.returnRows[0]; instance.selectReplacementItem(row); row.quantity = 3;
      instance.continueReturn(); await renderValidation(fixture);
      expect(form.querySelector('.mh-return-selection.mh-field-invalid')).toBeNull();
      expect(form.querySelector('.mh-return-quantity.mh-field-invalid')?.textContent).toContain('Choose a quantity from 1 to 2.');
      expect(form.querySelector('[aria-label="' + (type === 'replacement' ? 'Exchange reason' : 'Return reason') + '"]')?.getAttribute('aria-invalid')).toBe('true');
      if (type === 'replacement') {
        expect(form.querySelector('.mh-replacement-sizes')?.closest('.mh-field-invalid')?.textContent).toContain('Choose a replacement size.');
        instance.selectReplacementSize(row, 'L'); instance.selectReplacementReason(row, 'fit', 'too_small');
      } else {
        const group = instance.returnReasonGroups[type === 'defect' ? 0 : 1];
        instance.selectReturnReason(row, group, group.options[0]);
        if (type === 'defect') {
          expect(form.querySelector('.mh-defect-photo-slots .mh-field-invalid')?.textContent).toContain('Upload item photo 1');
          instance.defectPhotosByItem[row.orderItemId] = [{ file: new File(['photo'], 'one.png', { type: 'image/png' }), preview: 'blob:photo' }, null];
          instance.defectDisclaimerAccepted = true;
        }
      }
      row.quantity = 1;
      if (type === 'replacement') row.replacementNotes = 'x'.repeat(181);
      else row.comments = 'x'.repeat(251);
      instance.continueReturn(); await renderValidation(fixture);
      const details = form.querySelector<HTMLTextAreaElement>('.mh-return-row__explanation textarea')!;
      expect(details.getAttribute('aria-invalid')).toBe('true');
      expect(details.closest('.mh-field-invalid.mh-validation-shake')?.textContent).toContain('Keep additional details within');
      expect(getComputedStyle(details.closest('.mh-field-invalid')!).animationName).toContain('mh-field-shake');
      expect(getComputedStyle(details.closest('label')!.querySelector('.mh-field-error')!).color).toBe('rgb(180, 35, 24)');
      expect(form.querySelectorAll('.mh-field-invalid').length).toBe(1);
      instance.continueReturn(); fixture.detectChanges();
      expect(details.closest('.mh-validation-shake')).toBeNull();
      await renderValidation(fixture);
      expect(details.closest('.mh-validation-shake')).not.toBeNull();
      row.comments = ''; row.replacementNotes = ''; fixture.detectChanges();
      expect(form.querySelector('.mh-field-invalid')).toBeNull();
      expect(instance.returnError).toBe(''); fixture.destroy();
    }
    expect(account.createReturn).not.toHaveBeenCalled();
    expect(account.uploadDefectPhotos).not.toHaveBeenCalled();
  });

  it('requires defective-item disclaimer acknowledgement, links the policy and highlights unchecked terms locally', async () => {
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent); fixture.detectChanges();
    const instance = fixture.componentInstance;
    instance.returnEligibility = productEligibility(); instance.openReturn(order, 'defect');
    const row = instance.returnRows[0]; instance.selectReplacementItem(row);
    instance.selectReturnReason(row, instance.returnReasonGroups[0], instance.returnReasonGroups[0].options[0]);
    instance.defectPhotosByItem[row.orderItemId] = [{ file: new File(['photo'], 'one.png', { type: 'image/png' }), preview: 'blob:photo' }, null];
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>('dialog[aria-labelledby="return-title"]')!;
    const disclaimer = form.querySelector<HTMLElement>('.mh-defect-disclaimer')!;
    const checkbox = disclaimer.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const copy = disclaimer.querySelector<HTMLElement>('.mh-defect-disclaimer__copy')!;
    expect(checkbox.checked).toBeFalse(); expect(checkbox.required).toBeTrue();
    expect(copy.textContent).toContain('The product will be scheduled for pickup only after the images uploaded by you have been reviewed and verified by Monk Hagen.');
    expect(copy.textContent).toContain('it will be shipped back to you without a refund or replacement.');
    expect(getComputedStyle(copy).fontStyle).toBe('italic');
    expect(getComputedStyle(copy).color).toBe('rgb(122, 122, 114)');
    expect(copy.querySelector('a')?.getAttribute('href')).toBe('/refund-policy');
    expect(copy.querySelector('a')?.getAttribute('target')).toBe('_blank');
    expect(copy.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(copy.querySelector('a')?.textContent).toBe('Refund, Return & Exchange Policy');
    expect(disclaimer.querySelector('label[for="defect-policy-ack"]')?.textContent).toBe('I understand and agree to the above');
    expect(copy.querySelector('input, label')).toBeNull();
    expect(copy.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(form.textContent).not.toContain('We may contact you for supporting evidence.');
    const next = form.querySelector<HTMLButtonElement>('footer .mh-order-action--primary')!;
    next.click(); await renderValidation(fixture);
    expect(instance.returnStep).toBe('items');
    expect(disclaimer.classList.contains('mh-field-invalid')).toBeTrue();
    expect(disclaimer.classList.contains('mh-validation-shake')).toBeTrue();
    expect(checkbox.getAttribute('aria-invalid')).toBe('true');
    expect(disclaimer.querySelector('.mh-field-error')?.textContent).toContain('Please select the checkbox');
    expect(form.querySelector('.mh-tracking-error')).toBeNull();
    instance.submitReturn();
    expect(account.createReturn).not.toHaveBeenCalled(); expect(account.uploadDefectPhotos).not.toHaveBeenCalled();
    checkbox.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(disclaimer.classList.contains('mh-field-invalid')).toBeFalse();
    expect(disclaimer.querySelector('.mh-field-error')).toBeNull();
    next.click(); fixture.detectChanges();
    expect(instance.returnStep).toBe('refund');
    instance.closeReturn(); instance.clearReturn(); instance.openReturn(order, 'defect');
    expect(instance.defectDisclaimerAccepted).toBeFalse();
    instance.openReturn(order, 'return'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(form.querySelector('.mh-defect-disclaimer')).toBeNull(); fixture.destroy();
  });

  it('shows invalid file errors beside the affected photo slot and clears them after a valid upload', async () => {
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent); fixture.detectChanges();
    const instance = fixture.componentInstance;
    instance.returnEligibility = productEligibility(); instance.openReturn(order, 'defect');
    const row = instance.returnRows[0]; instance.selectReplacementItem(row);
    instance.selectReturnReason(row, instance.returnReasonGroups[0], instance.returnReasonGroups[0].options[0]);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>('dialog[aria-labelledby="return-title"]')!;
    const inputs = form.querySelectorAll<HTMLInputElement>('.mh-defect-photo-upload input');
    const invalid = new DataTransfer(); invalid.items.add(new File(['file'], 'item.txt', { type: 'text/plain' }));
    inputs[1].files = invalid.files; inputs[1].dispatchEvent(new Event('change'));
    await renderValidation(fixture);
    expect(inputs[1].closest('.mh-field-invalid.mh-validation-shake')?.textContent).toContain('Choose a JPG, PNG, WebP or AVIF photo, up to 5 MB.');
    expect(inputs[0].closest('.mh-field-invalid')).toBeNull();
    expect(form.querySelector('.mh-tracking-error')).toBeNull();
    const valid = new DataTransfer(); valid.items.add(new File(['photo'], 'item.png', { type: 'image/png' }));
    inputs[1].files = valid.files; inputs[1].dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(inputs[1].closest('.mh-field-invalid')).toBeNull(); fixture.destroy();
  });

  it('renders COD bank validation beside each input and submits only after matching valid details', async () => {
    account.createReturn.and.returnValue(new Subject());
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent); fixture.detectChanges();
    const instance = fixture.componentInstance; const eligibility = productEligibility();
    eligibility.items[0].refundableUnitAmounts = [1499, 1499];
    instance.returnEligibility = eligibility; instance.openReturn({ ...order, paymentMethod: 'cod' }, 'return');
    const row = instance.returnRows[0]; instance.selectReplacementItem(row);
    instance.selectReturnReason(row, instance.returnReasonGroups[1], instance.returnReasonGroups[1].options[0]);
    instance.continueReturn(); instance.refundMethod = 'BANK'; fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>('dialog[aria-labelledby="return-title"]')!;
    expect(form.querySelector('.mh-field-invalid')).toBeNull();
    instance.submitReturn(); await renderValidation(fixture);
    expect(form.querySelectorAll('.mh-refund-fields .mh-field-invalid.mh-validation-shake').length).toBe(4);
    expect(form.querySelector('#refund-holder-error')?.textContent).toContain('Enter the account holder name');
    expect(form.querySelector('#refund-account-error')?.textContent).toBe('Enter your account number.');
    expect(form.querySelector('#refund-account-confirm-error')?.textContent).toBe('Confirm your account number.');
    expect(form.querySelector('#refund-ifsc-error')?.textContent).toBe('Enter your IFSC code.');
    expect(form.querySelector('.mh-tracking-error')).toBeNull();
    instance.refundHolder = 'Test Buyer'; instance.refundAccount = '12345678';
    instance.refundAccountConfirm = '12345679'; instance.refundIfsc = 'HDFC0001234'; fixture.detectChanges();
    expect(form.querySelectorAll('.mh-field-invalid').length).toBe(1);
    expect(form.querySelector('#refund-account-confirm-error')?.textContent).toBe('Account numbers must match.');
    expect(account.createReturn).not.toHaveBeenCalled();
    instance.refundAccountConfirm = instance.refundAccount; fixture.detectChanges(); instance.submitReturn();
    expect(form.querySelector('.mh-field-invalid')).toBeNull();
    expect(account.createReturn.calls.mostRecent().args[0].refundDestination).toEqual({ method: 'BANK',
      accountHolderName: 'Test Buyer', accountNumber: '12345678', confirmAccountNumber: '12345678', ifsc: 'HDFC0001234', bankName: '' });
    fixture.destroy();
  });

  it('offers only Size & fit issues for exchanges and preserves the three fit reasons', async () => {
    account.createReturn.and.returnValue(new Subject());
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent);
    fixture.detectChanges();
    const instance = fixture.componentInstance;
    instance.returnEligibility = productEligibility(); instance.openReturn(order, 'replacement');
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>('dialog[aria-labelledby="return-title"]')!;
    form.querySelector<HTMLButtonElement>('[data-order-item="item-1"] .mh-replacement-product')!.click(); fixture.detectChanges();
    expect(Array.from(form.querySelectorAll('.mh-exchange-reason-grid .mh-return-reason-copy strong')).map(node => node.textContent))
      .toEqual(['Size & fit issues']);
    form.querySelector<HTMLButtonElement>('[data-reason-group="fit"] .mh-return-reason-head')!.click(); fixture.detectChanges();
    expect(Array.from(form.querySelectorAll('.mh-exchange-reason-option')).map(button => button.textContent?.trim()))
      .toEqual(['Size too small', 'Size too big', 'I did not like the fit']);
    form.querySelectorAll<HTMLButtonElement>('.mh-exchange-reason-option')[1].click(); fixture.detectChanges();
    expect(instance.returnRows[0].replacementReasonDetail).toBe('too_large');
    expect(form.querySelector('.mh-return-selected-reason')?.textContent).toContain('Size too big');
    expect(form.querySelector('[data-reason-group="wrong_item"]')).toBeNull();
    expect(form.querySelector('[data-reason-group="damaged"]')).toBeNull();
    Array.from(form.querySelectorAll<HTMLButtonElement>('.mh-replacement-sizes button')).find(button => button.textContent?.trim() === 'L')!.click();
    instance.submitReturn();
    expect(account.createReturn.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ requestType: 'replacement',
      items: [{ orderItemId: 'item-1', quantity: 1, reason: 'size_issue', replacementSize: 'L', comments: 'The selected size feels too large.' }] }));
    fixture.destroy();
  });

  it('disables expired defect categories and allows a cancelled product to be selected again', () => {
    const eligibility = productEligibility(); eligibility.requestTypes.find(type => type.code === 'defect')!.eligible = false;
    component.returnEligibility = eligibility; component.openReturn(order, 'return');
    expect(component.returnReasonGroupAvailable(component.returnReasonGroups[0])).toBeFalse();
    expect(component.returnReasonGroupAvailable(component.returnReasonGroups[3])).toBeFalse();
    expect(component.returnReasonGroupAvailable(component.returnReasonGroups[1])).toBeTrue();
    const row = component.returnRows[0]; component.selectReplacementItem(row);
    expect(row.selected).toBeTrue();
    component.selectReturnReason(row, component.returnReasonGroups[0], component.returnReasonGroups[0].options[0]);
    expect(row.reason).toBe('');
  });

  it('refreshes product locks after a conflicting request from another session', () => {
    component.returnEligibility = productEligibility(); component.openReturn(order, 'return');
    const row = component.returnRows[0]; component.selectReplacementItem(row);
    component.selectReturnReason(row, component.returnReasonGroups[1], component.returnReasonGroups[1].options[0]);
    account.createReturn.and.returnValue(throwError(() => ({ status: 409, error: { message: 'This product already has a request.' } })));
    account.getReturnEligibility.and.returnValue(of(productEligibility(true)));
    component.submitReturn();
    expect(row.alreadyRequested).toBeTrue(); expect(row.selected).toBeFalse();
    expect(component.canRequestReturn(order)).toBeTrue();
    component.submitReturn(); expect(account.createReturn).toHaveBeenCalledTimes(1);
  });

  it('keeps Return & Replace enabled for remaining quantities and disables it for fully requested or expired orders', async () => {
    const delivered = { ...order, status: 'delivered' } as Order;
    const eligibility = productEligibility(); eligibility.items = [eligibility.items[0]];
    eligibility.items[0] = { ...eligibility.items[0], returnedQuantity: 1, remainingQuantity: 1 };
    eligibility.hasExistingRequest = true;
    account.getOrders.and.returnValue(of([delivered]));
    account.getReturnEligibility.and.returnValue(of(eligibility));
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const button = Array.from(element.querySelectorAll<HTMLButtonElement>('.mh-customer-order__foot button'))
      .find(candidate => candidate.textContent?.includes('Return & Replace'))!;
    expect(button.disabled).toBeFalse();
    expect(element.querySelector('.mh-return-window')?.textContent).toContain('Exchange/Return available till');
    expect(element.querySelector('.mh-return-window > span')?.textContent).toBe('✓');
    expect(element.querySelector('.mh-return-window a')?.getAttribute('href')).toBe('/account/returns?orderId=order-1');
    const instance = fixture.componentInstance;
    instance.returnEligibilityByOrderId[order.id] = { ...eligibility, eligible: false,
      items: [{ ...eligibility.items[0], returnedQuantity: 2, remainingQuantity: 0, alreadyRequested: true }] };
    fixture.detectChanges(); expect(button.disabled).toBeTrue();
    instance.returnEligibilityByOrderId[order.id] = { ...eligibility, eligible: false, reason: 'WINDOW_CLOSED',
      requestTypes: eligibility.requestTypes.map(type => ({ ...type, eligible: false })) };
    fixture.detectChanges(); expect(button.disabled).toBeTrue();
    instance.returnEligibilityByOrderId[order.id] = { ...eligibility, hasExistingRequest: false,
      items: [{ ...eligibility.items[0], returnedQuantity: 0, remainingQuantity: 2, alreadyRequested: false }] };
    fixture.detectChanges(); expect(button.disabled).toBeFalse(); fixture.destroy();
  });

  it('updates remaining quantities immediately after each successful request', () => {
    const eligibility = productEligibility(); eligibility.items = [eligibility.items[0]];
    component.returnEligibility = eligibility; component.openReturn(order, 'return');
    account.createReturn.and.returnValue(of({ pickupDelayed: false } as any));
    for (const remaining of [1, 0]) {
      const row = component.returnRows[0];
      component.selectReplacementItem(row);
      component.selectReturnReason(row, component.returnReasonGroups[1], component.returnReasonGroups[1].options[0]);
      component.submitReturn();
      expect(component.returnEligibilityFor(order)?.items[0].remainingQuantity).toBe(remaining);
      expect(component.canRequestReturn(order)).toBe(remaining > 0);
      if (remaining) {
        component.openReturn(order, 'return');
        expect(component.returnRows[0].alreadyRequested).toBeFalse();
        expect(component.returnRows[0].max).toBe(1);
        expect(component.returnRows[0].requestedQuantity).toBe(1);
      }
    }
    expect(account.createReturn).toHaveBeenCalledTimes(2);
    expect(account.createReturn.calls.allArgs().map(args => args[0].items[0].quantity)).toEqual([1, 1]);
  });

  it('shows a link scoped to the order only after a request has been created, including cancelled history', async () => {
    const delivered = { ...order, status: 'delivered' } as Order;
    const eligibility = productEligibility();
    account.getOrders.and.returnValue(of([delivered])); account.getReturnEligibility.and.returnValue(of(eligibility));
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent); fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.mh-return-window a')).toBeNull();
    fixture.componentInstance.returnEligibilityByOrderId[order.id] = { ...eligibility, hasReturnHistory: true };
    fixture.detectChanges();
    const link = element.querySelector<HTMLAnchorElement>('.mh-return-window a')!;
    expect(link.textContent).toBe('View return & replacement');
    expect(link.getAttribute('href')).toBe('/account/returns?orderId=order-1');
    expect(fixture.componentInstance.canRequestReturn(delivered)).toBeTrue();
    fixture.destroy();
  });

  it('stacks distinct return options and navigates back from each form without losing the order', async () => {
    const eligibility: ReturnEligibility = {
      orderId: order.id, eligible: true, reason: null, message: null, returnUntil: new Date().toISOString(),
      requestTypes: [
        { code: 'defect', label: 'Issue', eligible: true, message: 'Defective item support.' },
        { code: 'return', label: 'Return', eligible: true, message: 'Return an item.' },
        { code: 'replacement', label: 'Exchange', eligible: true, message: 'Choose a different size.' }
      ],
      reasons: [{ code: 'size_issue', label: 'Size issue' }, { code: 'product_damaged', label: 'Damaged' }],
      items: [{ orderItemId: 'item-1', productName: 'Test tee', sku: null, size: 'M', color: 'Black',
        purchasedQuantity: 1, returnedQuantity: 0, remainingQuantity: 1, replacementSizes: ['M', 'L'] }]
    };
    await TestBed.configureTestingModule({ imports: [AccountOrdersComponent],
      providers: [{ provide: AccountService, useValue: account }, provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(AccountOrdersComponent);
    const instance = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    async function settle() {
      fixture.detectChanges(); await fixture.whenStable();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      fixture.detectChanges();
    }
    fixture.detectChanges();
    instance.returnEligibilityByOrderId[order.id] = eligibility;
    instance.openReturnChoices(order);
    await settle();
    const choices = Array.from(element.querySelectorAll<HTMLButtonElement>('.mh-return-choice__options button'));
    expect(choices.map(button => button.querySelector('strong')?.textContent)).toEqual(
      ['Size Exchange', 'Return Item', 'Return a defective item']);
    expect(choices[0].getBoundingClientRect().bottom).toBeLessThan(choices[1].getBoundingClientRect().top);
    expect(choices[1].getBoundingClientRect().bottom).toBeLessThan(choices[2].getBoundingClientRect().top);
    const colors = choices.map(button => getComputedStyle(button.querySelector('svg')!).color);
    expect(new Set(colors).size).toBe(3);
    const optionsDialog = element.querySelector<HTMLDialogElement>('.mh-return-choice-dialog')!;
    const formDialog = element.querySelector<HTMLDialogElement>('dialog[aria-labelledby="return-title"]')!;
    for (const [index, type] of (['replacement', 'return', 'defect'] as const).entries()) {
      element.querySelectorAll<HTMLButtonElement>('.mh-return-choice__options button')[index].click();
      await settle();
      expect(formDialog.open).withContext(`${type} form should open`).toBeTrue(); expect(optionsDialog.open).toBeFalse();
      expect(instance.returnRequestType).toBe(type);
      expect(instance.returnOrder?.id).toBe(order.id);
      const back = formDialog.querySelector<HTMLButtonElement>('.mh-return-back')!;
      expect(back.disabled).toBeFalse();
      instance.returnSubmitting = true; fixture.detectChanges();
      expect(back.disabled).toBeTrue();
      instance.returnSubmitting = false; fixture.detectChanges(); back.click();
      await settle();
      expect(formDialog.open).toBeFalse(); expect(optionsDialog.open).toBeTrue();
      expect(instance.returnChoiceOrder?.id).toBe(order.id);
      expect(instance.orderedReturnChoices().length).toBe(3);
    }
    expect(account.createReturn).not.toHaveBeenCalled();
    expect(account.getReturnEligibility).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('keeps the unavailable invoice button visible and disabled with a support explanation',async()=>{
    account.getOrders.and.returnValue(of([{...order,status:'confirmed',paymentMethod:'razorpay',invoiceAvailable:false}]));
    await TestBed.configureTestingModule({imports:[AccountOrdersComponent],providers:[{provide:AccountService,useValue:account},provideRouter([])]}).compileComponents();
    const fixture=TestBed.createComponent(AccountOrdersComponent);fixture.detectChanges();
    const element=fixture.nativeElement as HTMLElement;
    const button=Array.from(element.querySelectorAll('button')).find(b=>b.textContent?.includes('Download invoice'));
    expect(button).toBeDefined();expect(button?.disabled).toBeTrue();expect(button?.title).toContain('Contact support');
    expect(element.querySelector('.mh-invoice-state')?.textContent).toContain('Invoice not available yet');
    expect(account.getInvoice).not.toHaveBeenCalled();fixture.destroy();
  });
  it('enables a Shiprocket invoice for a COD order without requiring payment collection',async()=>{
    account.getOrders.and.returnValue(of([{...order,status:'confirmed',paymentMethod:'cod',paymentStatus:'pending',invoiceAvailable:true}]));
    await TestBed.configureTestingModule({imports:[AccountOrdersComponent],providers:[{provide:AccountService,useValue:account},provideRouter([])]}).compileComponents();
    const fixture=TestBed.createComponent(AccountOrdersComponent);fixture.detectChanges();
    const element=fixture.nativeElement as HTMLElement;
    const button=Array.from(element.querySelectorAll('button')).find(b=>b.textContent?.includes('Download invoice'));
    expect(button).toBeDefined();expect(button?.disabled).toBeFalse();expect(element.querySelector('.mh-invoice-state')).toBeNull();fixture.destroy();
  });

  it('keeps return reasons and submission state after the order-details dialog closes', () => {
    component.returnEligibility = {
      orderId: order.id, eligible: true, reason: null, message: null, returnUntil: new Date().toISOString(),
      requestTypes: [{ code: 'return', label: 'Return item', eligible: true, message: 'Return item is available.' }],
      reasons: [{ code: 'size_issue', label: 'Size issue' }],
      items: [{ orderItemId: 'item-1', productName: 'Test tee', sku: 'TEE-1', size: 'M', color: 'Black',
        purchasedQuantity: 1, returnedQuantity: 0, remainingQuantity: 1, replacementSizes: ['M','L'] }]
    };
    component.openReturn(order);
    component.clearDetails();

    expect(component.returnReasons).toEqual([{ code: 'size_issue', label: 'Size issue' }]);
    component.selectReplacementItem(component.returnRows[0]);
    component.selectReturnReason(component.returnRows[0], component.returnReasonGroups[1], component.returnReasonGroups[1].options[0]);
    account.createReturn.and.returnValue(of({ pickupDelayed: false } as any));
    component.submitReturn();

    expect(account.createReturn).toHaveBeenCalled();
  });
});
