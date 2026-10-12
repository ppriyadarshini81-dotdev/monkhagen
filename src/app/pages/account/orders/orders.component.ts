import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, distinctUntilChanged, forkJoin, map, of, Subscription, switchMap } from 'rxjs';
import { AccountService } from '../../../services/account.service';
import { CancellationEligibility, CodRefundDestinationPayload, Order, ReturnEligibility, TrackingInfo } from '../../../models/account.model';
import { saveInvoice } from '../../../utils/invoice-download';
import { FEATURE_FLAGS } from '../../../config/feature-flags';

@Component({
  selector: 'app-account-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.css', './orders-return-state.css', './orders-return-options.css', './orders-return-form.css']
})
export class AccountOrdersComponent implements OnInit, OnDestroy {
  readonly codEnabled = FEATURE_FLAGS.cashOnDelivery;
  @ViewChild('detailsDialog') detailsDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('trackingDialog') trackingDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('returnDialog') returnDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('returnChoiceDialog') returnChoiceDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('cancelDialog') cancelDialog?: ElementRef<HTMLDialogElement>;

  orders: Order[] = [];
  loading = true;
  loadError = '';
  linkedOrderError = '';
  private linkedOrderSubscription?: Subscription;
  page = 0;
  readonly pageSize = 10;
  hasNextPage = false;
  statusFilter = '';
  dateSort: 'newest' | 'oldest' = 'newest';
  dateFrom = '';
  dateTo = '';
  dateRange = { from: '', to: '' };
  dateRangeError = '';
  selectedOrder: Order | null = null;
  trackingOrder: Order | null = null;
  tracking: TrackingInfo | null = null;
  trackingLoading = false;
  trackingError = '';
  invoiceLoadingOrderId = '';
  invoiceError = '';
  returnEligibility: ReturnEligibility | null = null;
  readonly returnEligibilityByOrderId: Record<string, ReturnEligibility | undefined> = {};
  returnEligibilityLoading = false;
  returnChoiceLoadingOrderId = '';
  returnChoiceOrder: Order | null = null;
  returnChoiceEligibility: ReturnEligibility | null = null;
  returnError = '';
  returnValidationAttempted = false;
  defectDisclaimerAccepted = false;
  refundValidationAttempted = false;
  returnValidationShaking = true;
  private validationTimer?: ReturnType<typeof setTimeout>;
  private defectPhotoErrors: Record<string, string[]> = {};
  returnMessage = '';
  returnSubmitting = false;
  returnOrder: Order | null = null;
  returnIdempotencyKey = '';
  returnRequestType: 'return' | 'defect' | 'replacement' = 'return';
  returnStep: 'items' | 'refund' = 'items';
  refundMethod: 'UPI' | 'BANK' = 'UPI';
  refundUpi = ''; refundUpiConfirm = '';
  refundHolder = ''; refundAccount = ''; refundAccountConfirm = ''; refundIfsc = ''; refundBank = '';
  private refundableUnits: Record<string, number[]> = {};
  readonly defectPhotoSlots = [0, 1];
  defectPhotosByItem: Record<string, Array<{ file: File; preview: string } | null>> = {};
  private uploadedDefectPhotoIds: Record<string, string[]> = {};
  readonly replacementReasonGroups = [
    { value: 'fit', label: 'Size & fit issues', detail: "Doesn't fit me well", options: [
      { value: 'too_small', label: 'Size too small', detail: 'The selected size feels too small.' },
      { value: 'too_large', label: 'Size too big', detail: 'The selected size feels too large.' },
      { value: 'fit_issue', label: 'I did not like the fit', detail: 'The fit is not as expected.' }
    ] }
  ];
  returnReasons: ReturnEligibility['reasons'] = [];
  readonly returnReasonGroups = [
    { value: 'quality', label: 'Quality issues', detail: 'Poor quality product', options: [
      { value: 'poor_quality', label: 'Received a poor quality product', reason: 'quality_issue' },
      { value: 'image_mismatch', label: 'Product image was better than the actual product', reason: 'quality_issue' },
      { value: 'damaged', label: 'Received a damaged, used or stained item', reason: 'product_damaged' }
    ] },
    { value: 'fit', label: 'Size & fit issues', detail: "Doesn't fit me well", options: [
      { value: 'too_small', label: 'Size too small', reason: 'size_issue' },
      { value: 'too_large', label: 'Size too big', reason: 'size_issue' },
      { value: 'fit_issue', label: 'I did not like the fit', reason: 'size_issue' }
    ] },
    { value: 'mind', label: 'Changed my mind', detail: "I don't want this product", options: [
      { value: 'delayed', label: 'Delivery was delayed', reason: 'changed_mind' },
      { value: 'not_needed', label: 'I do not need it anymore', reason: 'changed_mind' }
    ] },
    { value: 'different', label: 'Different product', detail: 'Not what I ordered', options: [
      { value: 'different_color', label: 'Received the same product, but different color', reason: 'wrong_item' },
      { value: 'different_size', label: 'Received the same product, but different size', reason: 'wrong_item' },
      { value: 'different_product', label: 'Received a completely different product', reason: 'wrong_item' }
    ] }
  ];
  returnRows: Array<{ orderItemId: string; productName: string; imageUrl: string | null; size: string | null; color: string | null; unitPrice: number; replacementSizes: string[]; replacementSize: string; replacementSizeServerError: string; replacementReasonDetail: string; replacementNotes: string; expandedReasonGroup: string; reasonGroup: string; reasonDetail: string; alreadyRequested: boolean; purchasedQuantity: number; requestedQuantity: number; selected: boolean; quantity: number; max: number; reason: string; comments: string }> = [];
  cancellationEligibility: CancellationEligibility | null = null;
  cancellationLoading = false;
  cancellationOrder: Order | null = null;
  cancellationReason = '';
  cancellationNotes = '';
  readonly cancellationReasons = [
    'Ordered by mistake',
    'Changed my mind',
    'Found a better price',
    'Delivery is taking too long',
    'Need to change my address or items',
    'Other'
  ];
  cancellationSubmitting = false;
  cancellationError = '';

  constructor(private account: AccountService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.loadOrders();
    this.linkedOrderSubscription = this.route.queryParamMap.pipe(
      map(params => params.get('orderId') || ''),
      distinctUntilChanged(),
      switchMap(orderId => {
        this.linkedOrderError = '';
        if (!orderId) return of(null);
        return this.account.getOrder(orderId).pipe(catchError(() => {
          this.linkedOrderError = 'We could not open this order. Please try again.';
          return of(null);
        }));
      })
    ).subscribe(order => { if (order) this.openDetails(order); });
  }
  ngOnDestroy(): void { this.linkedOrderSubscription?.unsubscribe(); clearTimeout(this.validationTimer); this.clearDefectPhotos(); }
  loadOrders(page = this.page): void {
    this.loading = true; this.loadError = '';
    this.account.getOrders(this.pageSize, page * this.pageSize, this.statusFilter, this.dateSort,
      this.dateRange.from, this.dateRange.to).subscribe({
      next: (orders) => {
        this.orders = orders; this.page = page; this.hasNextPage = orders.length === this.pageSize;
        this.loadDeliveredEligibility(orders);
        this.loading = false;
      },
      error: () => {
        this.loadError = 'We could not load your orders. Please refresh and try again.';
        this.loading = false;
      }
    });
  }
  changePage(direction: number): void {
    const next = this.page + direction;
    if (next < 0 || (direction > 0 && !this.hasNextPage)) return;
    this.loadOrders(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  applyStatusFilter(): void { this.loadOrders(0); }

  applyDateRange(): void {
    if (this.loading) return;
    this.dateRangeError = '';
    if (this.dateFrom && this.dateTo && this.dateFrom > this.dateTo) {
      this.dateRangeError = 'From date must be on or before To date.';
      return;
    }
    this.dateRange = { from: this.dateFrom, to: this.dateTo };
    this.loadOrders(0);
  }

  clearDateRange(): void {
    if (this.loading) return;
    this.dateFrom = ''; this.dateTo = ''; this.dateRangeError = '';
    this.dateRange = { from: '', to: '' };
    this.loadOrders(0);
  }

  private loadDeliveredEligibility(orders: Order[]): void {
    for (const order of orders) {
      if (this.orderStage(order) !== 4 || this.isCancelled(order)) continue;
      this.account.getReturnEligibility(order.id).subscribe({
        next: eligibility => { this.returnEligibilityByOrderId[order.id] = eligibility; },
        error: () => { this.returnEligibilityByOrderId[order.id] = undefined; }
      });
    }
  }

  returnEligibilityFor(order: Order): ReturnEligibility | undefined { return this.returnEligibilityByOrderId[order.id]; }

  hasReturnRequest(order: Order): boolean {
    const eligibility = this.returnEligibilityFor(order);
    return Boolean(eligibility?.hasExistingRequest) || Boolean(eligibility?.items.some(item => item.returnedQuantity > 0));
  }

  hasReturnHistory(order: Order): boolean {
    return Boolean(this.returnEligibilityFor(order)?.hasReturnHistory) || this.hasReturnRequest(order);
  }

  canRequestReturn(order: Order): boolean {
    const eligibility = this.returnEligibilityFor(order);
    return Boolean(eligibility?.eligible && eligibility.items.some(item => item.remainingQuantity > 0)) && !this.returnSubmitting;
  }

  openReturnChoices(order: Order): void {
    const eligibility = this.returnEligibilityFor(order);
    if (eligibility) { this.showReturnChoices(order, eligibility); return; }
    if (this.returnChoiceLoadingOrderId) return;
    this.returnChoiceLoadingOrderId = order.id;
    this.account.getReturnEligibility(order.id).subscribe({
      next: result => {
        this.returnEligibilityByOrderId[order.id] = result;
        this.returnChoiceLoadingOrderId = '';
        this.showReturnChoices(order, result);
      },
      error: () => { this.returnChoiceLoadingOrderId = ''; }
    });
  }

  private showReturnChoices(order: Order, eligibility: ReturnEligibility): void {
    if (!eligibility.eligible || !eligibility.items.some(item => item.remainingQuantity > 0)) return;
    this.returnChoiceOrder = order;
    this.returnChoiceEligibility = eligibility;
    queueMicrotask(() => this.returnChoiceDialog?.nativeElement.showModal());
  }

  chooseReturnRequest(requestType: 'return' | 'defect' | 'replacement'): void {
    const order = this.returnChoiceOrder;
    const eligibility = this.returnChoiceEligibility;
    if (!order || !eligibility?.requestTypes.some(type => type.code === requestType && type.eligible)) return;
    this.returnEligibility = eligibility;
    this.returnChoiceDialog?.nativeElement.close();
    this.openReturn(order, requestType);
  }

  closeReturnChoices(): void { this.returnChoiceDialog?.nativeElement.close(); }

  backToReturnChoices(): void {
    if (this.returnSubmitting || !this.returnOrder) return;
    const order = this.returnOrder;
    this.closeReturn();
    this.openReturnChoices(order);
  }

  clearReturnChoices(): void {
    if (this.returnChoiceDialog?.nativeElement.open) return;
    this.returnChoiceOrder = null; this.returnChoiceEligibility = null;
  }

  returnChoiceLabel(type: 'return' | 'defect' | 'replacement'): string {
    return type === 'replacement' ? 'Size Exchange' : type === 'return' ? 'Return Item' : 'Return a defective item';
  }

  orderedReturnChoices(): ReturnEligibility['requestTypes'] {
    const types = this.returnChoiceEligibility?.requestTypes || [];
    return ['replacement', 'return', 'defect'].map(code => types.find(type => type.code === code)).filter(Boolean) as ReturnEligibility['requestTypes'];
  }

  openDetails(order: Order): void {
    this.selectedOrder = order;
    this.returnEligibility = null;
    this.returnEligibilityLoading = true;
    this.account.getReturnEligibility(order.id).subscribe({
      next: eligibility => { this.returnEligibility = eligibility; this.returnEligibilityByOrderId[order.id] = eligibility; this.returnEligibilityLoading = false; },
      error: error => {
        this.returnEligibility = { orderId: order.id, eligible: false, reason: 'UNAVAILABLE',
          message: error?.error?.message || 'Return availability could not be checked.', returnUntil: null,
          requestTypes: [], defectReportingEnded: false, reasons: [], items: [] };
        this.returnEligibilityLoading = false;
      }
    });
    this.cancellationEligibility = null;
    this.cancellationLoading = true;
    this.account.getCancellationEligibility(order.id).subscribe({ next: eligibility => { this.cancellationEligibility = eligibility; this.cancellationLoading = false; }, error: () => { this.cancellationLoading = false; } });
    queueMicrotask(() => this.detailsDialog?.nativeElement.showModal());
  }

  openCancellation(order: Order): void {
    if (this.cancellationLoading) return;
    this.cancellationOrder = order; this.cancellationReason = ''; this.cancellationNotes = ''; this.cancellationError = ''; this.cancellationSubmitting = false;
    this.trackingDialog?.nativeElement.close();
    queueMicrotask(() => this.cancelDialog?.nativeElement.showModal());
  }
  closeCancellation(): void { this.cancelDialog?.nativeElement.close(); }
  submitCancellation(): void {
    if (!this.cancellationOrder || this.cancellationSubmitting) return;
    const reason = this.cancellationReason.trim();
    const notes = this.cancellationNotes.trim();
    this.cancellationError = '';
    if (!reason) { this.cancellationError = 'Select a cancellation reason.'; return; }
    if (reason === 'Other' && !notes) { this.cancellationError = 'Tell us the reason for cancelling this order.'; return; }
    const savedReason = notes ? `${reason}: ${notes}` : reason;
    this.cancellationSubmitting = true;
    this.account.cancelOrder(this.cancellationOrder.id, savedReason).subscribe({
      next: cancellation => { const order = this.orders.find(item => item.id === this.cancellationOrder?.id); if (order) {
        order.status = 'cancelled';
        order.cancellation = { status: 'cancelled', reason: savedReason,
          cancelledAt: new Date().toISOString(), refundStatus: cancellation?.refundStatus || 'not_applicable' };
      }
        this.returnMessage = cancellation?.refundStatus === 'processing' ? 'Order cancelled. Your refund has been initiated.' : 'Order cancelled.';
        this.loadOrders(0);
        this.cancellationSubmitting = false; this.closeCancellation(); this.closeDetails(); },
      error: error => { this.cancellationSubmitting = false; this.cancellationError = error?.error?.message || 'We could not cancel this order. Please try again.'; }
    });
  }

  openReturn(order: Order, requestType: 'return' | 'defect' | 'replacement' = 'return'): void {
    const eligibility = this.returnEligibility;
    if (!eligibility?.requestTypes.find(type => type.code === requestType && type.eligible)) return;
    this.returnEligibilityByOrderId[order.id] = eligibility;
    this.returnOrder = order;
    this.returnIdempotencyKey = this.newUuid();
    this.returnRequestType = requestType;
    this.returnStep = 'items'; this.clearRefundDestination();
    this.clearDefectPhotos();
    this.refundableUnits = Object.fromEntries(eligibility.items.map(item => [item.orderItemId, item.refundableUnitAmounts || []]));
    const allowedReasons = requestType === 'defect'
      ? ['product_damaged', 'wrong_item', 'quality_issue']
      : requestType === 'replacement' ? ['size_issue'] : ['size_issue', 'changed_mind', 'other'];
    this.returnReasons = eligibility.reasons.filter(reason => allowedReasons.includes(reason.code));
    this.returnError = '';
    this.returnValidationAttempted = false;
    this.defectDisclaimerAccepted = false;
    this.returnRows = eligibility.items.map(item => {
      const orderItem = order.items.find(candidate => candidate.id === item.orderItemId);
      return {
      orderItemId: item.orderItemId, productName: item.productName, imageUrl: orderItem?.imageUrl || null,
      size: item.size, color: item.color, unitPrice: orderItem?.unitPrice || 0, replacementSizes: item.replacementSizes || [],
      replacementSize: '', replacementSizeServerError: '', replacementReasonDetail: '', replacementNotes: '', expandedReasonGroup: '',
      reasonGroup: '', reasonDetail: '', alreadyRequested: item.remainingQuantity <= 0,
      purchasedQuantity: item.purchasedQuantity, requestedQuantity: item.returnedQuantity, selected: false,
      quantity: 1, max: item.remainingQuantity, reason: '', comments: ''
      };
    });
    this.closeDetails();
    queueMicrotask(() => this.returnDialog?.nativeElement.showModal());
  }

  closeReturn(): void { this.returnDialog?.nativeElement.close(); }

  selectReplacementItem(selected: typeof this.returnRows[number]): void {
    if (selected.alreadyRequested || this.returnSubmitting) return;
    selected.selected = !selected.selected;
    selected.quantity = 1;
    selected.reason = selected.selected && this.returnRequestType === 'replacement' ? 'size_issue' : '';
    if (!selected.selected) { selected.replacementSize = ''; selected.replacementSizeServerError = ''; selected.replacementReasonDetail = ''; selected.replacementNotes = ''; selected.expandedReasonGroup = ''; selected.reasonGroup = ''; selected.reasonDetail = ''; selected.comments = ''; }
  }

  orderedReturnRows(): typeof this.returnRows {
    return [...this.returnRows].sort((a, b) => Number(b.selected) - Number(a.selected) || Number(a.alreadyRequested) - Number(b.alreadyRequested));
  }

  orderedReturnReasonGroups(row: typeof this.returnRows[number]): typeof this.returnReasonGroups {
    const first = row.reasonGroup || row.expandedReasonGroup;
    return this.returnReasonGroups
      .filter(group => this.returnRequestType !== 'return' || ['fit', 'mind'].includes(group.value))
      .filter(group => this.returnRequestType !== 'defect' || this.isDefectReason(group.options[0].reason))
      .sort((a, b) => Number(b.value === first) - Number(a.value === first));
  }

  orderedReplacementReasonGroups(row: typeof this.returnRows[number]): typeof this.replacementReasonGroups {
    const first = row.replacementReasonDetail ? 'fit' : row.expandedReasonGroup;
    return [...this.replacementReasonGroups].sort((a, b) => Number(b.value === first) - Number(a.value === first));
  }

  replacementReasonLabel(row: typeof this.returnRows[number]): string {
    return this.replacementReasonGroups.flatMap(group => group.options)
      .find(option => option.value === row.replacementReasonDetail)?.label || '';
  }

  orderedReturnReasonOptions(row: typeof this.returnRows[number], group: typeof this.returnReasonGroups[number]): typeof group.options {
    return [...group.options].sort((a, b) => Number(b.value === row.reasonDetail) - Number(a.value === row.reasonDetail));
  }

  private isDefectReason(reason: string): boolean { return ['quality_issue', 'product_damaged', 'wrong_item'].includes(reason); }

  returnReasonGroupAvailable(group: typeof this.returnReasonGroups[number]): boolean {
    if (this.returnRequestType === 'return' && !['fit', 'mind'].includes(group.value)) return false;
    const type = this.isDefectReason(group.options[0].reason) ? 'defect' : 'return';
    const eligibility = this.returnEligibilityByOrderId[this.returnOrder?.id || ''] || this.returnEligibility;
    return (this.returnRequestType !== 'defect' || type === 'defect') &&
      Boolean(eligibility?.requestTypes.some(candidate => candidate.code === type && candidate.eligible));
  }

  returnReasonUnavailableMessage(group: typeof this.returnReasonGroups[number]): string {
    if (this.returnRequestType === 'defect' && !this.isDefectReason(group.options[0].reason)) {
      return 'Choose Return Item for size, fit or changed-mind requests.';
    }
    return this.isDefectReason(group.options[0].reason)
      ? 'The 2-day defective-item window has closed.' : 'The 7-day return window has closed.';
  }

  toggleReturnReasonGroup(row: typeof this.returnRows[number], group: typeof this.returnReasonGroups[number]): void {
    if (this.returnSubmitting || !this.returnReasonGroupAvailable(group)) return;
    row.expandedReasonGroup = row.expandedReasonGroup === group.value ? '' : group.value;
  }

  selectReturnReason(row: typeof this.returnRows[number], group: typeof this.returnReasonGroups[number], option: typeof group.options[number]): void {
    if (row.alreadyRequested || this.returnSubmitting || !this.returnReasonGroupAvailable(group)) return;
    row.reason = option.reason; row.reasonDetail = option.value; row.reasonGroup = group.value;
    row.expandedReasonGroup = group.value; this.returnError = '';
  }

  returnReasonLabel(row: typeof this.returnRows[number]): string {
    return this.returnReasonGroups.flatMap(group => group.options).find(option => option.value === row.reasonDetail)?.label || '';
  }

  returnComments(row: typeof this.returnRows[number]): string {
    return [this.returnReasonLabel(row), row.comments.trim()].filter(Boolean).join(' ');
  }

  returnCommentLimit(row: typeof this.returnRows[number]): number { return 250 - this.returnReasonLabel(row).length - 1; }

  returnSubmissionType(): 'replacement' | 'return' | 'defect' {
    return this.returnRequestType;
  }

  selectReplacementSize(row: typeof this.returnRows[number], size: string): void { row.replacementSize = size; row.replacementSizeServerError = ''; }

  toggleReplacementReasonGroup(row: typeof this.returnRows[number], group: string): void {
    row.expandedReasonGroup = row.expandedReasonGroup === group ? '' : group;
  }

  selectReplacementReason(row: typeof this.returnRows[number], group: string, reason: string): void {
    if (group !== 'fit' || !this.replacementReasonGroups[0].options.some(option => option.value === reason)) return;
    this.returnError = '';
    row.replacementReasonDetail = reason;
  }

  returnSelectionError(): string {
    if (!this.returnValidationAttempted) return '';
    if (!this.returnRows.some(row => row.selected)) return 'Select at least one item.';
    const eligibility = this.returnEligibilityByOrderId[this.returnOrder?.id || ''] || this.returnEligibility;
    return eligibility?.requestTypes.some(type => type.code === this.returnRequestType && type.eligible)
      ? '' : 'This request window has closed. Go back to options to check availability.';
  }

  private itemValidationError(row: typeof this.returnRows[number], field: string): string {
    if (!row.selected) return '';
    if (field === 'selection') return row.alreadyRequested ? 'This item already has a return or replacement request. Select another item.' : '';
    if (field === 'quantity') return Number.isInteger(row.quantity) && row.quantity >= 1 && row.quantity <= row.max
      ? '' : `Choose a quantity from 1 to ${row.max}.`;
    if (this.returnRequestType === 'replacement') {
      if (field === 'size') return !row.replacementSize ? 'Choose a replacement size.'
        : row.replacementSize === row.size || !row.replacementSizes.includes(row.replacementSize) ? 'Choose an available size different from your original size.' : '';
      if (field === 'reason') return this.replacementReasonGroups[0].options.some(option => option.value === row.replacementReasonDetail)
        ? '' : 'Choose a fit reason.';
      if (field === 'comments') return row.replacementNotes.length > 180 ? 'Keep additional details within 180 characters.' : '';
    } else {
      if (field === 'reason') return this.orderedReturnReasonGroups(row).some(group => group.value === row.reasonGroup &&
        this.returnReasonGroupAvailable(group) && group.options.some(option => option.value === row.reasonDetail && option.reason === row.reason))
        ? '' : 'Select a category and choose a return reason.';
      if (field === 'comments') return this.returnComments(row).length > 250
        ? `Keep additional details within ${this.returnCommentLimit(row)} characters.` : '';
    }
    return '';
  }

  returnFieldError(row: typeof this.returnRows[number], field: string): string {
    if (field === 'size' && row.selected && row.replacementSizeServerError) return row.replacementSizeServerError;
    return this.returnValidationAttempted ? this.itemValidationError(row, field) : '';
  }

  defectPhotoError(row: typeof this.returnRows[number], slot: number): string {
    if (!row.selected || this.returnRequestType !== 'defect') return '';
    return this.defectPhotoErrors[row.orderItemId]?.[slot] ||
      (this.returnValidationAttempted && slot === 0 && !this.defectPhotosByItem[row.orderItemId]?.[0] ? 'Upload item photo 1 showing the issue.' : '');
  }

  defectDisclaimerError(): string {
    return this.returnRequestType === 'defect' && this.returnValidationAttempted && !this.defectDisclaimerAccepted
      ? 'Please select the checkbox to acknowledge the defective-item return terms before continuing.' : '';
  }

  private refundValidationError(field: string): string {
    if (this.refundMethod === 'UPI') {
      if (field === 'upi') return !this.refundUpi.trim() ? 'Enter your UPI ID.'
        : /^[A-Za-z0-9][A-Za-z0-9._+-]{1,254}@[A-Za-z0-9][A-Za-z0-9.-]{1,63}$/.test(this.refundUpi.trim()) ? '' : 'Enter a valid UPI ID, such as name@bank.';
      if (field === 'upiConfirm') return !this.refundUpiConfirm.trim() ? 'Confirm your UPI ID.'
        : this.refundUpi.trim().toLowerCase() === this.refundUpiConfirm.trim().toLowerCase() ? '' : 'UPI IDs must match.';
    } else {
      if (field === 'holder') return this.refundHolder.trim().length < 2 ? 'Enter the account holder name (at least 2 characters).' : '';
      if (field === 'account') return !this.refundAccount.trim() ? 'Enter your account number.'
        : /^\d{6,20}$/.test(this.refundAccount.trim()) ? '' : 'Enter an account number with 6 to 20 digits.';
      if (field === 'accountConfirm') return !this.refundAccountConfirm.trim() ? 'Confirm your account number.'
        : this.refundAccount.trim() === this.refundAccountConfirm.trim() ? '' : 'Account numbers must match.';
      if (field === 'ifsc') return !this.refundIfsc.trim() ? 'Enter your IFSC code.'
        : /^[A-Z]{4}0[A-Z0-9]{6}$/.test(this.refundIfsc.trim().toUpperCase()) ? '' : 'Enter a valid 11-character IFSC code.';
    }
    return '';
  }

  refundFieldError(field: string): string { return this.refundValidationAttempted ? this.refundValidationError(field) : ''; }

  private highlightValidation(): void {
    this.returnError = '';
    this.returnValidationShaking = false;
    clearTimeout(this.validationTimer);
    this.validationTimer = setTimeout(() => {
      this.returnValidationShaking = true;
      const invalid = this.returnDialog?.nativeElement.querySelector<HTMLElement>('.mh-field-invalid');
      invalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      invalid?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true });
    }, 32);
  }

  returnRefundGross(): number {
    const paise = this.returnRows.filter(row => row.selected).reduce((sum, row) => {
      const units = this.refundableUnits[row.orderItemId];
      return sum + (units?.length ? units.slice(0, row.quantity).reduce((amount, value) => amount + Math.round(value * 100), 0)
        : Math.round(row.unitPrice * 100) * row.quantity);
    }, 0);
    return paise / 100;
  }
  returnRefundDeduction(): number {
    return this.returnRequestType === 'return' ? Math.min(this.returnRefundGross(),
      (this.returnEligibilityByOrderId[this.returnOrder?.id || ''] || this.returnEligibility)?.shippingDeductionAmount ?? 150) : 0;
  }
  returnRefundNet(): number { return Math.round((this.returnRefundGross() - this.returnRefundDeduction()) * 100) / 100; }
  clearRefundDestination(): void {
    this.refundValidationAttempted = false;
    this.refundMethod = 'UPI'; this.refundUpi = ''; this.refundUpiConfirm = '';
    this.refundHolder = ''; this.refundAccount = ''; this.refundAccountConfirm = ''; this.refundIfsc = ''; this.refundBank = '';
  }
  private returnRefundDestination(): CodRefundDestinationPayload {
    return this.refundMethod === 'UPI' ? { method: 'UPI', upiId: this.refundUpi, confirmUpiId: this.refundUpiConfirm }
      : { method: 'BANK', accountHolderName: this.refundHolder, accountNumber: this.refundAccount,
        confirmAccountNumber: this.refundAccountConfirm, ifsc: this.refundIfsc, bankName: this.refundBank };
  }
  continueReturn(): void { this.submitReturn(true); }
  backToReturnItems(): void { if (!this.returnSubmitting) { this.returnStep = 'items'; this.returnError = ''; } }

  selectDefectPhoto(row: typeof this.returnRows[number], slot: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file || this.returnSubmitting) return;
    if (!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      (this.defectPhotoErrors[row.orderItemId] ||= ['', ''])[slot] = 'Choose a JPG, PNG, WebP or AVIF photo, up to 5 MB.';
      this.highlightValidation(); return;
    }
    this.removeDefectPhoto(row, slot);
    const photos = this.defectPhotosByItem[row.orderItemId] ||= [null, null];
    photos[slot] = { file, preview: URL.createObjectURL(file) }; this.returnError = '';
  }
  removeDefectPhoto(row: typeof this.returnRows[number], slot: number): void {
    if (this.returnSubmitting) return;
    if (this.defectPhotoErrors[row.orderItemId]) this.defectPhotoErrors[row.orderItemId][slot] = '';
    const photo = this.defectPhotosByItem[row.orderItemId]?.[slot];
    if (photo) { URL.revokeObjectURL(photo.preview); this.defectPhotosByItem[row.orderItemId][slot] = null; }
    delete this.uploadedDefectPhotoIds[row.orderItemId];
  }
  clearDefectPhotos(): void {
    Object.values(this.defectPhotosByItem).forEach(photos => photos.forEach(photo => { if (photo) URL.revokeObjectURL(photo.preview); }));
    this.defectPhotosByItem = {}; this.uploadedDefectPhotoIds = {}; this.defectPhotoErrors = {};
  }

  submitReturn(reviewOnly = false): void {
    const order = this.returnOrder;
    if (!order || !this.returnIdempotencyKey || this.returnSubmitting) return;
    this.returnValidationAttempted = true;
    const selected = this.returnRows.filter(row => row.selected);
    const requestType = this.returnSubmissionType();
    if (this.returnSelectionError() || this.defectDisclaimerError() || selected.some(row => ['selection', 'quantity', 'size', 'reason', 'comments'].some(field => this.returnFieldError(row, field)) ||
      (requestType === 'defect' && this.defectPhotoSlots.some(slot => this.defectPhotoError(row, slot))))) {
      this.returnStep = 'items'; this.highlightValidation(); return;
    }
    if (reviewOnly && requestType !== 'replacement') { this.returnStep = 'refund'; this.returnError = ''; return; }
    const needsDestination = order.paymentMethod === 'cod' && requestType !== 'replacement' && this.returnRefundNet() > 0;
    if (needsDestination) {
      this.refundValidationAttempted = true;
      if (['upi', 'upiConfirm', 'holder', 'account', 'accountConfirm', 'ifsc'].some(field => this.refundFieldError(field))) {
        this.returnStep = 'refund'; this.highlightValidation(); return;
      }
    }
    this.returnSubmitting = true;
    this.returnError = '';
    const uploads = requestType === 'defect' ? selected.filter(row => !this.uploadedDefectPhotoIds[row.orderItemId]).map(row =>
      this.account.uploadDefectPhotos(order.id, row.orderItemId, this.defectPhotosByItem[row.orderItemId].filter(photo => photo !== null).map(photo => photo!.file))
        .pipe(map(photos => { this.uploadedDefectPhotoIds[row.orderItemId] = photos.map(photo => photo.id); return photos; }))) : [];
    (uploads.length ? forkJoin(uploads) : of([])).pipe(switchMap(() => this.account.createReturn({
      orderId: order.id,
      idempotencyKey: this.returnIdempotencyKey,
      requestType,
      ...(needsDestination ? { refundDestination: this.returnRefundDestination() } : {}),
      items: selected.map(row => {
        const replacementReason = this.replacementReasonGroups[0].options.find(reason => reason.value === row.replacementReasonDetail);
        const comments = this.returnRequestType === 'replacement'
          ? [replacementReason?.detail, row.replacementNotes.trim()].filter(Boolean).join(' ')
          : this.returnComments(row);
        return { orderItemId: row.orderItemId, quantity: Number(row.quantity), reason: row.reason,
          ...(requestType === 'defect' ? { photoIds: this.uploadedDefectPhotoIds[row.orderItemId] } : {}),
          ...(comments ? { comments } : {}), ...(this.returnRequestType === 'replacement' ? { replacementSize: row.replacementSize } : {}) };
      })
    }))).subscribe({
      next: result => {
        this.returnSubmitting = false;
        const eligibility = this.returnEligibilityByOrderId[order.id] || this.returnEligibility;
        if (eligibility) {
          const items = eligibility.items.map(item => {
            const row = selected.find(candidate => candidate.orderItemId === item.orderItemId);
            return row ? { ...item, alreadyRequested: item.remainingQuantity <= row.quantity, returnedQuantity: item.returnedQuantity + row.quantity,
              remainingQuantity: Math.max(0, item.remainingQuantity - row.quantity) } : item;
          });
          const requested = { ...eligibility, items, hasExistingRequest: true, hasReturnHistory: true,
            eligible: items.some(item => item.remainingQuantity > 0) && eligibility.requestTypes.some(type => type.eligible) };
          this.returnEligibilityByOrderId[order.id] = requested;
          this.returnEligibility = requested;
        }
        this.loadDeliveredEligibility([order]);
        this.returnMessage = result.defectPhotoReviewPending ? 'Your defective-item request is awaiting admin photo review. Pickup is arranged after review.' : result.pickupDelayed
          ? 'We received your return request, but pickup scheduling is taking longer than expected.'
          : 'Your return request has been created and pickup is being scheduled.';
        this.returnIdempotencyKey = '';
        this.closeReturn();
      },
      error: error => {
        this.returnSubmitting = false;
        const response = error?.error;
        if (this.returnRequestType === 'replacement' && response?.field === 'replacementSize' && response?.orderItemId) {
          const row = this.returnRows.find(candidate => candidate.orderItemId === response.orderItemId);
          if (row) { row.replacementSizeServerError = response.message || 'This size is no longer available for this product.'; this.highlightValidation(); return; }
        }
        this.returnError = response?.message || 'We could not create the return request. Please try again.';
        if (error?.status === 409) {
          this.account.getReturnEligibility(order.id).subscribe({
            next: eligibility => {
              this.returnEligibilityByOrderId[order.id] = eligibility;
              this.returnEligibility = eligibility;
              for (const row of this.returnRows) {
                const item = eligibility.items.find(candidate => candidate.orderItemId === row.orderItemId);
                if (item) {
                  row.max = item.remainingQuantity;
                  row.requestedQuantity = item.returnedQuantity;
                  row.quantity = Math.min(row.quantity, Math.max(1, row.max));
                  row.alreadyRequested = item.remainingQuantity <= 0;
                  if (row.alreadyRequested) row.selected = false;
                }
              }
            }, error: () => {}
          });
        }
      }
    });
  }

  quantityOptions(max: number): number[] {
    return Array.from({ length: max }, (_, index) => index + 1);
  }

  private newUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const value = Math.floor(Math.random() * 16);
      return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
    });
  }

  closeDetails(): void {
    this.detailsDialog?.nativeElement.close();
  }

  openTracking(order: Order): void {
    this.trackingOrder = order;
    this.tracking = null;
    this.trackingError = '';
    this.trackingLoading = true;
    this.cancellationEligibility = null;
    this.cancellationLoading = true;
    this.account.getCancellationEligibility(order.id).subscribe({
      next: eligibility => { this.cancellationEligibility = eligibility; this.cancellationLoading = false; },
      error: () => { this.cancellationLoading = false; }
    });
    queueMicrotask(() => {
      const dialog = this.trackingDialog?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    });
    if (this.isCancelled(order)) {
      this.trackingLoading = false;
      return;
    }
    this.account.getTracking(order.id).subscribe({
      next: (tracking) => {
        this.tracking = tracking;
        this.trackingLoading = false;
      },
      error: (error) => {
        this.trackingError = error?.error?.message || 'Tracking information is temporarily unavailable.';
        this.trackingLoading = false;
      }
    });
  }

  trackFromDetails(order: Order): void {
    this.closeDetails();
    queueMicrotask(() => this.openTracking(order));
  }

  closeTracking(): void {
    this.trackingDialog?.nativeElement.close();
  }

  downloadInvoice(order: Order): void {
    if (!order.invoiceAvailable || this.invoiceLoadingOrderId) return;
    this.invoiceError = '';
    this.invoiceLoadingOrderId = order.id;
    this.account.getInvoice(order.id).subscribe({
      next: (response) => {
        this.invoiceLoadingOrderId = '';
        try { saveInvoice(response, `${order.orderNumber}_Invoice.pdf`); }
        catch { this.invoiceError = 'Invoice is not available yet. Please try again later.'; }
      },
      error: () => {
        this.invoiceLoadingOrderId = '';
        this.invoiceError = 'Invoice is not available yet. Please try again later.';
      }
    });
  }
  invoiceHint(order:Order):string {
    return order.invoiceAvailable?'Download your invoice':'Your invoice is not available yet. Contact support for assistance.';
  }

  clearDetails(): void {
    this.selectedOrder = null;
    this.returnEligibility = null;
    this.cancellationEligibility = null;
  }
  clearCancellation(): void { this.cancellationOrder = null; this.cancellationReason = ''; this.cancellationNotes = ''; this.cancellationError = ''; this.cancellationSubmitting = false; }

  clearReturn(): void {
    if (this.returnDialog?.nativeElement.open) return;
    clearTimeout(this.validationTimer);
    this.returnOrder = null;
    this.returnIdempotencyKey = '';
    this.returnReasons = [];
    this.returnRows = [];
    this.clearDefectPhotos();
    this.returnStep = 'items'; this.clearRefundDestination(); this.refundableUnits = {};
    this.returnError = '';
    this.returnValidationAttempted = false;
    this.defectDisclaimerAccepted = false;
  }

  clearTracking(): void {
    this.trackingOrder = null;
    this.tracking = null;
    this.trackingError = '';
  }

  orderStage(order: Order): number {
    const orderStatus = (order.status || '').toLowerCase();
    const shippingStatus = (order.shippingStatus || '').toLowerCase();
    if (order.deliveredAt || orderStatus === 'delivered' || shippingStatus.includes('delivered')) return 4;
    if (order.shippedAt || order.awbNumber || ['shipped', 'pickup_scheduled', 'awb_assigned'].some((value) =>
      orderStatus === value || shippingStatus.includes(value))) return 3;
    if (orderStatus === 'processing' || !['', 'not_created', 'pending'].includes(shippingStatus)) return 2;
    return 1;
  }

  isCancelled(order: Order): boolean { return order.status === 'cancelled'; }

  trackingStage(order: Order, tracking: TrackingInfo | null): number {
    if (!tracking) return this.orderStage(order);
    const status = `${tracking.shippingStatus || ''} ${tracking.trackingStatus || ''}`.toLowerCase();
    if (status.includes('deliver')) return 4;
    if (tracking.awbCode || status.includes('ship') || status.includes('pickup')) return 3;
    if (!status.includes('not_created') && !status.includes('pending')) return 2;
    return 1;
  }

  deliveryLabel(order: Order): string {
    if (this.isCancelled(order)) return 'Order cancelled';
    const stage = this.orderStage(order);
    if (stage === 4) return 'Delivered';
    if (stage === 3) return 'On the way';
    if (stage === 2) return 'Preparing shipment';
    return 'Order confirmed';
  }

  statusLabel(status: string | null | undefined): string {
    if (!status) return 'Awaiting update';
    return status.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  }

  isPendingCod(order: Order): boolean {
    return order.paymentMethod === 'cod' && order.paymentStatus === 'pending';
  }

  paymentMethodLabel(order: Order): string {
    return order.paymentMethod === 'cod' ? 'Cash on delivery' : this.statusLabel(order.paymentMethod);
  }
}
