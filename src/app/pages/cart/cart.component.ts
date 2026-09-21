import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Address, AddressPayload } from '../../models/account.model';
import { CartItem } from '../../models/cart.model';
import { AccountService } from '../../services/account.service';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { PaymentOrder, PaymentService, RazorpaySuccess } from '../../services/payment.service';
import { AnalyticsService } from '../../services/analytics.service';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.css'
})
export class CartComponent implements OnInit {
  @ViewChild('addressDialog') addressDialog!: ElementRef<HTMLDialogElement>;
  addingAddress = false;
  loadingAddresses = false;
  shipping = { name: '', address: '', city: '', state: '', zip: '', phone: '' };
  addresses: Address[] = [];
  selectedAddressId = '';
  lastSelectedAddressId = '';
  addressAttempted = false;
  placing = false;
  error = '';
  checkoutError = '';
  orderId: string | null = null;

  constructor(
    public cart: CartService,
    private account: AccountService,
    private auth: AuthService,
    private payments: PaymentService,
    private analytics: AnalyticsService
  ) {}

  ngOnInit(): void {
    this.analytics.track('CART_VIEWED');
  }

  checkout(): void {
    if (this.placing) return;
    this.error = '';
    this.checkoutError = '';
    this.addressAttempted = false;
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

  get grandTotal(): number {
    return this.cart.total + this.shippingFee;
  }

  continueCheckout(): void {
    if (this.placing || this.loadingAddresses) return;
    this.checkoutError = '';
    if (!this.selectedAddressId && !this.addingAddress) {
      this.checkoutError = 'Select a saved delivery address or add a new one.';
      return;
    }
    if (this.addingAddress && ['name', 'address', 'city', 'state', 'zip', 'phone']
        .some((field) => Boolean(this.addressFieldError(field)))) {
      this.addressAttempted = true;
      return;
    }
    this.placing = true;
    this.analytics.track('ADDRESS_SELECTED');
    if (this.selectedAddressId) {
      this.startPayment(this.selectedAddressId);
      return;
    }

    this.account.addAddress(this.addressPayload()).subscribe({
      next: (address) => {
        this.addresses = [...this.addresses, address];
        this.selectedAddressId = address.id;
        this.lastSelectedAddressId = address.id;
        this.addingAddress = false;
        this.startPayment(address.id);
      },
      error: (err) => this.fail(err?.error?.message || 'Could not save the shipping address.')
    });
  }

  selectAddress(addressId: string): void {
    this.addingAddress = false;
    this.selectedAddressId = addressId;
    this.lastSelectedAddressId = addressId;
    this.addressAttempted = false;
    this.checkoutError = '';
    const address = this.addresses.find((item) => item.id === addressId);
    if (!address) return;
    this.shipping = {
      name: address.fullName,
      address: address.addressLine1,
      city: address.city,
      state: address.state,
      zip: address.postalCode,
      phone: address.phone
    };
  }

  newAddress(): void {
    this.selectedAddressId = '';
    this.addingAddress = true;
    this.addressAttempted = false;
    this.checkoutError = '';
    this.shipping = { name: '', address: '', city: '', state: '', zip: '', phone: '' };
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
      phone: this.shipping.phone
    };
    const value = values[field]?.trim() || '';
    if (!value) {
      const labels: Record<string, string> = {
        name: 'Full name', address: 'Delivery address', city: 'City', state: 'State',
        zip: 'PIN code', phone: 'Mobile number'
      };
      return `${labels[field] || 'This field'} is required.`;
    }
    if (field === 'name' && value.length < 2) return 'Enter the recipient’s full name.';
    if (field === 'address' && value.length < 5) return 'Enter a complete house, street and area.';
    if (field === 'city' && value.length < 2) return 'Enter a valid city.';
    if (field === 'state' && value.length < 2) return 'Enter a valid state.';
    if (field === 'zip' && !/^[1-9]\d{5}$/.test(value)) return 'Enter a valid 6-digit Indian PIN code.';
    if (field === 'phone' && !/^[6-9]\d{9}$/.test(value)) return 'Enter a valid 10-digit Indian mobile number.';
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

  private startPayment(addressId: string): void {
    this.payments.createOrder(addressId, this.newCheckoutToken()).subscribe({
      next: (order) => this.openRazorpay(order),
      error: (err) => this.fail(err?.error?.message || 'Could not prepare the payment.')
    });
  }

  private async openRazorpay(order: PaymentOrder): Promise<void> {
    this.addressDialog.nativeElement.close();
    try {
      const result = await this.payments.openCheckout(order, {
        name: this.shipping.name,
        email: this.auth.currentUser?.email || undefined,
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
        this.placing = false;
      },
      error: (err) => this.fail(
        err?.error?.message || 'Payment could not be verified. Your cart has not been cleared.'
      )
    });
  }

  private addressPayload(): AddressPayload {
    return {
      fullName: this.shipping.name.trim(),
      phone: this.shipping.phone.trim(),
      addressLine1: this.shipping.address.trim(),
      city: this.shipping.city.trim(),
      state: this.shipping.state.trim(),
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
