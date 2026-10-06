import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest, filter, take } from 'rxjs';
import { Address, AddressPayload, IndiaLocations } from '../../models/account.model';
import { CartItem } from '../../models/cart.model';
import { AccountService } from '../../services/account.service';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { PaymentOrder, PaymentService, RazorpaySuccess } from '../../services/payment.service';
import { AnalyticsService } from '../../services/analytics.service';
import { OrderService } from '../../services/order.service';
import { canonicalLocation, stateFor } from '../../utils/india-locations';
import { FEATURE_FLAGS } from '../../config/feature-flags';

type CheckoutStep = 'address' | 'payment';
type PaymentMethod = 'razorpay' | 'cod';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.css'
})
export class CartComponent implements OnInit, AfterViewInit {
  readonly codEnabled = FEATURE_FLAGS.cashOnDelivery;
  @ViewChild('addressDialog') addressDialog!: ElementRef<HTMLDialogElement>;
  addingAddress = false;
  loadingAddresses = false;
  shipping = { name: '', address: '', addressLine2: '', landmark: '', city: '', state: '', zip: '', phone: '', email: '' };
  addresses: Address[] = [];
  selectedAddressId = '';
  lastSelectedAddressId = '';
  editingAddressId = '';
  addressAttempted = false;
  placing = false;
  error = '';
  checkoutError = '';
  orderId: string | null = null;
  checkoutStep: CheckoutStep = 'address';
  paymentMethod: PaymentMethod = 'razorpay';
  private checkoutToken = '';
  locations: IndiaLocations | null = null;
  locationsLoading = false;
  locationError = '';
  pincodeLoading = false;
  pincodeError = '';
  verifiedPincode = '';
  private pincodeRequest = 0;
  private locationsRequested = false;

  constructor(
    public cart: CartService,
    private account: AccountService,
    private auth: AuthService,
    private payments: PaymentService,
    private analytics: AnalyticsService,
    private orders: OrderService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.analytics.track('CART_VIEWED');
    if (this.auth.isLoggedIn) this.loadAddressLocations();
  }

  private loadAddressLocations(): void {
    if (this.locationsRequested) return;
    this.locationsRequested = true;
    this.locationsLoading = true;
    this.account.getAddressLocations().subscribe({
      next: locations => { this.locations = locations; this.locationsLoading = false; },
      error: () => {
        this.locationsLoading = false;
        this.locationError = 'State and city options could not be loaded. Please refresh and try again.';
      }
    });
  }

  ngAfterViewInit(): void {
    if (!this.auth.isLoggedIn || this.route.snapshot.queryParamMap.get('checkout') !== '1') return;
    combineLatest([this.auth.user$, this.cart.loading$]).pipe(
      filter(([user, loading]) => Boolean(user) && !loading),
      take(1)
    ).subscribe(() => {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { checkout: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
      queueMicrotask(() => this.checkout());
    });
  }

  checkout(): void {
    if (this.placing || this.cart.loading) return;
    if (!this.auth.isLoggedIn) {
      this.cart.closePreview();
      this.router.navigate(['/login'], { queryParams: { redirect: '/cart?checkout=1' } });
      return;
    }
    this.loadAddressLocations();
    this.error = '';
    this.checkoutError = '';
    this.addressAttempted = false;
    this.checkoutStep = 'address';
    this.paymentMethod = 'razorpay';
    this.checkoutToken ||= this.newCheckoutToken();
    this.addressDialog.nativeElement.showModal();
    this.analytics.track('CHECKOUT_STARTED');
    this.loadAddresses();
  }

  loadAddresses(): void {
    this.loadingAddresses = true;
    this.account.getAddresses().subscribe({
      next: (addresses) => {
        this.addresses = addresses;
        const selected = addresses.find((address) => address.isDefault) || addresses[0];
        if (selected) this.selectAddress(selected.id);
        else this.newAddress();
        this.loadingAddresses = false;
      },
      error: () => {
        this.loadingAddresses = false;
        this.checkoutError = 'Could not load your saved addresses. Please retry.';
      }
    });
  }

  get shippingFee(): number {
    return 0;
  }

  get codFee(): number {
    return this.codEnabled && this.paymentMethod === 'cod' ? 100 : 0;
  }

  get grandTotal(): number {
    return this.cart.total - this.checkoutDiscount + this.shippingFee + this.codFee;
  }

  get checkoutDiscount(): number {
    return this.paymentMethod === 'razorpay' && this.cart.prepaidOffer.eligible
      ? this.cart.prepaidOffer.discountAmount
      : 0;
  }

  get cartSummaryTotal(): number {
    return this.cart.total - (this.cart.prepaidOffer.eligible ? this.cart.prepaidOffer.discountAmount : 0) + this.shippingFee;
  }

  continueCheckout(): void {
    if (this.placing || this.loadingAddresses) return;
    this.checkoutError = '';
    if (!this.selectedAddressId && !this.addingAddress) {
      this.checkoutError = 'Select a saved delivery address or add a new one.';
      return;
    }
    if (this.addingAddress && (this.pincodeLoading || this.verifiedPincode !== this.shipping.zip.trim() || ['name', 'address', 'city', 'state', 'zip', 'phone', 'email']
        .some((field) => Boolean(this.addressFieldError(field))))) {
      this.addressAttempted = true;
      if (!this.pincodeError && !this.pincodeLoading && this.verifiedPincode !== this.shipping.zip.trim()) this.pincodeError = 'Please enter a valid Indian PIN code.';
      return;
    }
    if (this.selectedAddressId) {
      const selected = this.addresses.find((address) => address.id === this.selectedAddressId);
      if (!selected?.email || !/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(selected.email.trim())) {
        this.checkoutError = 'This saved address needs an email address for shipment tracking. Edit this address to continue.';
        return;
      }
      if (this.pincodeLoading || this.verifiedPincode !== selected.postalCode) {
        this.checkoutError = this.pincodeError || 'PIN code verification is still in progress.';
        return;
      }
      this.showPaymentStep(this.selectedAddressId);
      return;
    }

    this.placing = true;
    const payload = this.addressPayload();
    const request = this.editingAddressId
      ? this.account.updateAddress(this.editingAddressId, payload)
      : this.account.addAddress(payload);
    request.subscribe({
      next: (address) => {
        this.addresses = this.editingAddressId
          ? this.addresses.map(item => item.id === address.id ? address : item)
          : [...this.addresses, address];
        this.selectedAddressId = address.id;
        this.lastSelectedAddressId = address.id;
        this.editingAddressId = '';
        this.addingAddress = false;
        this.showPaymentStep(address.id);
      },
      error: (err) => this.fail(err?.error?.message || 'Could not save the shipping address.')
    });
  }

  backToAddress(): void {
    if (this.placing) return;
    this.checkoutError = '';
    this.checkoutStep = 'address';
  }

  placeOrder(): void {
    if (this.placing || !this.selectedAddressId) return;
    this.checkoutError = '';
    this.placing = true;

    if (this.codEnabled && this.paymentMethod === 'cod') {
      this.orders.checkout(this.selectedAddressId, this.checkoutToken).subscribe({
        next: (order) => {
          this.orderId = order.orderNumber || order.id;
          this.cart.reset();
          this.checkoutToken = '';
          this.placing = false;
          this.addressDialog.nativeElement.close();
        },
        error: (err) => this.fail(err?.error?.message || 'Could not place the cash on delivery order.')
      });
      return;
    }

    this.startPayment(this.selectedAddressId);
  }

  selectAddress(addressId: string): void {
    this.addingAddress = false;
    this.editingAddressId = '';
    this.selectedAddressId = addressId;
    this.lastSelectedAddressId = addressId;
    this.addressAttempted = false;
    this.checkoutError = '';
    const address = this.addresses.find((item) => item.id === addressId);
    if (!address) return;
    this.shipping = {
      name: address.fullName,
      address: address.addressLine1,
      addressLine2: address.addressLine2 || '',
      landmark: address.landmark || '',
      city: address.city,
      state: address.state,
      zip: address.postalCode,
      phone: address.phone,
      email: address.email || this.auth.currentUser?.email || ''
    };
    this.verifySavedAddressPincode(address);
  }

  newAddress(): void {
    this.selectedAddressId = '';
    this.editingAddressId = '';
    this.addingAddress = true;
    this.addressAttempted = false;
    this.checkoutError = '';
    this.shipping = { name: '', address: '', addressLine2: '', landmark: '', city: '', state: '', zip: '', phone: '', email: this.auth.currentUser?.email || '' };
    this.verifiedPincode = '';
    this.pincodeError = '';
  }

  editAddress(address: Address): void {
    if (this.placing) return;
    this.selectedAddressId = '';
    this.editingAddressId = address.id;
    this.addingAddress = true;
    this.addressAttempted = false;
    this.checkoutError = '';
    this.shipping = {
      name: address.fullName, address: address.addressLine1, addressLine2: address.addressLine2 || '',
      landmark: address.landmark || '', city: address.city, state: address.state, zip: address.postalCode,
      phone: address.phone, email: address.email || this.auth.currentUser?.email || ''
    };
    this.pincodeChanged(address.postalCode);
  }

  editSelectedAddress(): void {
    const selected = this.addresses.find(address => address.id === this.selectedAddressId);
    if (selected) this.editAddress(selected);
  }

  get canEditSelectedAddress(): boolean {
    return Boolean(this.selectedAddressId && (this.checkoutError || this.pincodeError));
  }

  get stateOptions(): string[] {
    return this.locations?.states.map(state => state.name) || [];
  }

  get cityOptions(): string[] {
    return stateFor(this.locations, this.shipping.state)?.cities || [];
  }

  get pincodeLocked(): boolean {
    return Boolean(this.verifiedPincode) && this.verifiedPincode === this.shipping.zip.trim();
  }

  stateChanged(state: string): void {
    if (this.pincodeLocked) return;
    this.shipping.state = state;
    this.shipping.city = '';
  }

  pincodeChanged(value: string): void {
    this.shipping.zip = value.replace(/\D/g, '').slice(0, 6);
    this.verifiedPincode = '';
    this.pincodeError = '';
    const request = ++this.pincodeRequest;
    if (this.shipping.zip.length !== 6) { this.pincodeLoading = false; return; }
    this.pincodeLoading = true;
    this.account.lookupPincode(this.shipping.zip).subscribe({
      next: location => {
        if (request !== this.pincodeRequest) return;
        this.shipping.zip = location.postalCode;
        this.shipping.state = location.state;
        this.shipping.city = location.city;
        this.verifiedPincode = location.postalCode;
        this.pincodeLoading = false;
      },
      error: err => {
        if (request !== this.pincodeRequest) return;
        this.pincodeLoading = false;
        this.pincodeError = err?.status === 400
          ? 'Please enter a valid Indian PIN code.'
          : 'PIN code verification is unavailable. Please retry.';
      }
    });
  }

  private verifySavedAddressPincode(address: Address): void {
    this.verifiedPincode = '';
    this.pincodeError = '';
    const request = ++this.pincodeRequest;
    this.pincodeLoading = true;
    this.account.lookupPincode(address.postalCode).subscribe({
      next: location => {
        if (request !== this.pincodeRequest) return;
        this.pincodeLoading = false;
        const expected = canonicalLocation(this.locations, address.state, address.city);
        if (!expected || expected.state !== location.state || expected.city !== location.city) {
          this.pincodeError = 'This saved address no longer matches its PIN code. Add a corrected delivery address to continue.';
          return;
        }
        this.verifiedPincode = address.postalCode;
      },
      error: err => {
        if (request !== this.pincodeRequest) return;
        this.pincodeLoading = false;
        this.pincodeError = err?.status === 400
          ? 'This saved address has an invalid PIN code. Add a corrected delivery address to continue.'
          : 'PIN code verification is unavailable. Please retry.';
      }
    });
  }

  cancelNewAddress(): void {
    const fallback = this.addresses.find((address) => address.id === this.lastSelectedAddressId) ||
      this.addresses.find((address) => address.isDefault) || this.addresses[0];
    if (fallback) this.selectAddress(fallback.id);
  }

  addressFieldError(field: string): string {
    const values: Record<string, string> = {
      name: this.shipping.name,
      address: this.shipping.address,
      city: this.shipping.city,
      state: this.shipping.state,
      zip: this.shipping.zip,
      phone: this.shipping.phone,
      email: this.shipping.email
    };
    const value = values[field]?.trim() || '';
    if (!value) {
      const labels: Record<string, string> = {
        name: 'Full name', address: 'Delivery address', city: 'City', state: 'State',
        zip: 'PIN code', phone: 'Mobile number', email: 'Email address'
      };
      return `${labels[field] || 'This field'} is required.`;
    }
    if (field === 'name' && value.length < 2) return 'Enter the recipient’s full name.';
    if (field === 'address' && value.length < 5) return 'Enter a complete house, street and area.';
    if (field === 'city' && value.length < 2) return 'Enter a valid city.';
    if (field === 'state' && value.length < 2) return 'Enter a valid state.';
    if (field === 'state' && this.locations && !stateFor(this.locations, value)) return 'Select a valid Indian state.';
    if (field === 'city' && this.locations && this.shipping.state &&
        !canonicalLocation(this.locations, this.shipping.state, value)) {
      return 'Select a city that belongs to the selected state.';
    }
    if (field === 'zip' && !/^[1-9]\d{5}$/.test(value)) return 'Enter a valid 6-digit Indian PIN code.';
    if (field === 'zip' && this.pincodeError) return this.pincodeError;
    if (field === 'phone' && !/^[6-9]\d{9}$/.test(value)) return 'Enter a valid 10-digit Indian mobile number.';
    if (field === 'email' && !/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(value)) return 'Enter a valid email address for shipment tracking.';
    return '';
  }

  closeAddressDialog(): void {
    if (!this.placing) {
      this.checkoutError = '';
      this.addressAttempted = false;
      this.addressDialog.nativeElement.close();
    }
  }

  updateQuantity(item: CartItem, quantity: number): void {
    this.error = '';
    this.cart.updateQuantity(item.id, quantity).subscribe({
      error: (err) => { this.error = err?.error?.message || 'Could not update the cart.'; }
    });
  }

  remove(item: CartItem): void {
    this.error = '';
    this.cart.remove(item.id).subscribe({
      error: (err) => { this.error = err?.error?.message || 'Could not remove the item.'; }
    });
  }

  private showPaymentStep(addressId: string): void {
    this.selectedAddressId = addressId;
    this.checkoutStep = 'payment';
    this.placing = false;
    this.analytics.track('ADDRESS_SELECTED');
  }

  private startPayment(addressId: string): void {
    this.payments.createOrder(addressId, this.checkoutToken).subscribe({
      next: (order) => this.openRazorpay(order),
      error: (err) => this.fail(err?.error?.message || 'Could not prepare the payment.')
    });
  }

  private async openRazorpay(order: PaymentOrder): Promise<void> {
    this.addressDialog.nativeElement.close();
    try {
      const result = await this.payments.openCheckout(order, {
        name: this.shipping.name,
        email: this.shipping.email || undefined,
        contact: this.shipping.phone
      });
      this.verifyPayment(order, result);
    } catch (error) {
      if (error instanceof Error && error.message.includes('closed')) {
        this.analytics.track('PAYMENT_WINDOW_CLOSED');
      }
      this.fail(error instanceof Error ? error.message : 'Payment was not completed.');
    }
  }

  private verifyPayment(order: PaymentOrder, result: RazorpaySuccess): void {
    this.payments.verify(order.localOrderId, result).subscribe({
      next: (verified) => {
        this.orderId = verified.orderNumber;
        this.cart.reset();
        this.checkoutToken = '';
        this.placing = false;
      },
      error: (err) => this.fail(
        err?.error?.message || 'Payment could not be verified. Your cart has not been cleared.'
      )
    });
  }

  private addressPayload(): AddressPayload {
    const location = canonicalLocation(this.locations, this.shipping.state, this.shipping.city);
    return {
      fullName: this.shipping.name.trim(),
      phone: this.shipping.phone.trim(),
      email: this.shipping.email.trim().toLowerCase(),
      addressLine1: this.shipping.address.trim(),
      addressLine2: this.shipping.addressLine2.trim(),
      landmark: this.shipping.landmark.trim(),
      city: location?.city || this.shipping.city.trim(),
      state: location?.state || this.shipping.state.trim(),
      postalCode: this.shipping.zip.trim(),
      country: 'India',
      addressType: 'Home'
    };
  }

  private newCheckoutToken(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const value = Math.floor(Math.random() * 16);
      return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
    });
  }

  private fail(message: string): void {
    if (this.addressDialog?.nativeElement.open) this.checkoutError = message;
    else this.error = message;
    this.placing = false;
  }
}
