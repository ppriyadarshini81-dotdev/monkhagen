import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Address, AddressPayload } from '../../models/account.model';
import { CartItem } from '../../models/cart.model';
import { AccountService } from '../../services/account.service';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { PaymentOrder, PaymentService, RazorpaySuccess } from '../../services/payment.service';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.css'
})
export class CartComponent {
  @ViewChild('addressDialog') addressDialog!: ElementRef<HTMLDialogElement>;
  addingAddress = false;
  loadingAddresses = false;
  shipping = { name: '', address: '', city: '', state: '', zip: '', phone: '' };
  addresses: Address[] = [];
  selectedAddressId = '';
  placing = false;
  error = '';
  orderId: string | null = null;

  constructor(
    public cart: CartService,
    private account: AccountService,
    private auth: AuthService,
    private payments: PaymentService
  ) {}

  checkout(): void {
    if (this.placing) return;
    this.error = '';
    this.addressDialog.nativeElement.showModal();
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
      error: () => { this.loadingAddresses = false; this.error = 'Could not load your saved addresses. Please retry.'; }
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
    this.error = '';
    if (this.shipping.name.trim().length < 2 || this.shipping.address.trim().length < 5 ||
        this.shipping.city.trim().length < 2 || this.shipping.state.trim().length < 2 ||
        !/^[1-9]\d{5}$/.test(this.shipping.zip.trim()) || !/^[6-9]\d{9}$/.test(this.shipping.phone.trim())) {
      this.error = 'Enter a full name, complete address, city, state, valid 6-digit PIN and 10-digit Indian mobile number. For an invalid saved address, add a corrected address.';
      return;
    }
    this.placing = true;
    if (this.selectedAddressId) {
      this.startPayment(this.selectedAddressId);
      return;
    }

    this.account.addAddress(this.addressPayload()).subscribe({
      next: (address) => {
        this.addresses = [...this.addresses, address];
        this.selectedAddressId = address.id;
        this.addingAddress = false;
        this.startPayment(address.id);
      },
      error: (err) => this.fail(err?.error?.message || 'Could not save the shipping address.')
    });
  }

  selectAddress(addressId: string): void {
    this.addingAddress = false;
    this.selectedAddressId = addressId;
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
    this.shipping = { name: '', address: '', city: '', state: '', zip: '', phone: '' };
  }

  closeAddressDialog(): void {
    if (!this.placing) this.addressDialog.nativeElement.close();
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
    this.error = message;
    this.placing = false;
  }
}
