import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { Order, ReturnEligibility } from '../../../models/account.model';
import { AccountService } from '../../../services/account.service';
import { AccountOrdersComponent } from './orders.component';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

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
    expect(form.querySelectorAll('.mh-return-reason-card').length).toBe(4);
    form.querySelector<HTMLButtonElement>('[data-reason-group="mind"] button')!.click(); fixture.detectChanges();
    expect(form.querySelector('.mh-return-reason-card')?.getAttribute('data-reason-group')).toBe('mind');
    const radios = form.querySelectorAll<HTMLInputElement>('[data-reason-group="mind"] input[type="radio"]');
    expect(radios.length).toBe(4); radios[3].click(); fixture.detectChanges();
    expect(form.querySelector('.mh-return-selected-reason')?.textContent).toContain('I do not need it anymore');
    expect(form.querySelector('[data-reason-group="mind"] .mh-return-reason-options label')?.textContent).toContain('I do not need it anymore');
    instance.returnRows[2].quantity = 2;
    instance.submitReturn();
    expect(account.createReturn.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ requestType: 'return',
      items: [{ orderItemId: 'item-3', quantity: 2, reason: 'changed_mind', comments: 'I do not need it anymore' }] }));
    fixture.destroy();
  });

  it('routes quality reasons through the defect policy and prevents mixing them with normal returns', () => {
    component.returnEligibility = productEligibility(); component.openReturn(order, 'return');
    const [quality, fit] = component.returnRows;
    component.selectReplacementItem(quality); component.selectReplacementItem(fit);
    component.selectReturnReason(quality, component.returnReasonGroups[0], component.returnReasonGroups[0].options[0]);
    component.selectReturnReason(fit, component.returnReasonGroups[1], component.returnReasonGroups[1].options[0]);
    component.submitReturn(); expect(account.createReturn).not.toHaveBeenCalled();
    expect(component.returnError).toContain('separately');
    component.selectReplacementItem(fit);
    account.createReturn.and.returnValue(new Subject()); component.submitReturn();
    expect(account.createReturn.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ requestType: 'defect',
      items: [{ orderItemId: 'item-1', quantity: 1, reason: 'quality_issue', comments: 'Received a poor quality product' }] }));
  });

  it('uses return-style exchange reason cards while preserving options and replacement submission rules', async () => {
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
      .toEqual(['Size & fit issues', 'Different product', 'Damaged / Used / Stained']);
    const options = {
      fit: ['Size too small', 'Size too big', 'I did not like the fit'],
      wrong_item: ['Received the same product, but different color', 'Received the same product, but different size', 'Received a completely different product'],
      damaged: ['Item is damaged', 'Item appears used', 'Item is stained']
    };
    for (const [group, labels] of Object.entries(options)) {
      form.querySelector<HTMLButtonElement>(`.mh-exchange-reason-grid [data-reason-group="${group}"] .mh-return-reason-head`)!.click();
      fixture.detectChanges();
      expect(Array.from(form.querySelectorAll('.mh-exchange-reason-option')).map(button => button.textContent?.trim())).toEqual(labels);
    }
    form.querySelector<HTMLButtonElement>('[data-reason-group="fit"] .mh-return-reason-head')!.click(); fixture.detectChanges();
    form.querySelectorAll<HTMLButtonElement>('.mh-exchange-reason-option')[1].click(); fixture.detectChanges();
    expect(instance.returnRows[0].replacementReasonDetail).toBe('too_large');
    expect(form.querySelector('.mh-return-selected-reason')?.textContent).toContain('Size too big');
    form.querySelector<HTMLButtonElement>('[data-reason-group="wrong_item"] .mh-return-reason-head')!.click(); fixture.detectChanges();
    form.querySelectorAll<HTMLButtonElement>('.mh-exchange-reason-option')[0].click(); fixture.detectChanges();
    expect(instance.returnRows[0].replacementReasonDetail).toBe('too_large');
    expect(instance.returnError).toContain('Return a defective item');
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
    component.returnRows[0].selected = true;
    component.returnRows[0].reason = 'size_issue';
    account.createReturn.and.returnValue(of({ pickupDelayed: false } as any));
    component.submitReturn();

    expect(account.createReturn).toHaveBeenCalled();
  });
});
