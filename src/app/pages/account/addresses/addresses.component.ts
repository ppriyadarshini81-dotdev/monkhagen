import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AccountService } from '../../../services/account.service';
import { AuthService } from '../../../services/auth.service';
import { Address, AddressPayload, IndiaLocations } from '../../../models/account.model';
import { canonicalLocation, sameLocation, stateFor, withLegacyOption } from '../../../utils/india-locations';

const EMPTY_FORM = (): AddressPayload => ({
  fullName: '', phone: '', email: '', addressLine1: '', addressLine2: '',
  landmark: '', city: '', state: '', postalCode: '', country: 'India', addressType: 'Home'
});

@Component({
  selector: 'app-account-addresses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './addresses.component.html',
  styleUrl: './addresses.component.css'
})
export class AccountAddressesComponent implements OnInit {
  addresses: Address[] = [];
  showForm = false;
  editingId: string | null = null;
  form: AddressPayload = EMPTY_FORM();
  customAddressType = '';
  saving = false;
  error = '';
  attempted = false;
  touched = new Set<keyof AddressPayload>();
  locations: IndiaLocations | null = null;
  locationsLoading = true;
  locationError = '';
  pincodeLoading = false;
  pincodeError = '';
  verifiedPincode = '';
  private pincodeRequest = 0;
  private legacyLocation: { state: string; city: string } | null = null;
  @ViewChild('addressFormElement', { read: ElementRef }) addressFormElement?: ElementRef<HTMLFormElement>;

  constructor(private account: AccountService, private auth: AuthService) {}

  ngOnInit(): void {
    this.load();
    this.account.getAddressLocations().subscribe({
      next: locations => {
        this.locations = locations;
        this.normaliseKnownLocation();
        this.locationsLoading = false;
      },
      error: () => {
        this.locationsLoading = false;
        this.locationError = 'State and city options could not be loaded. Please refresh and try again.';
      }
    });
  }
  load(): void { this.account.getAddresses().subscribe(a => this.addresses = a); }

  openAdd(): void { this.editingId = null; this.legacyLocation = null; this.form = { ...EMPTY_FORM(), email: this.auth.currentUser?.email || '' }; this.customAddressType = ''; this.verifiedPincode = ''; this.pincodeError = ''; this.showForm = true; this.resetValidation(); }
  openEdit(a: Address): void {
    this.editingId = a.id;
    this.legacyLocation = { state: a.state, city: a.city };
    this.form = { fullName: a.fullName, phone: a.phone, email: a.email || this.auth.currentUser?.email || '', addressLine1: a.addressLine1,
      addressLine2: a.addressLine2 || '', landmark: a.landmark || '',
      city: a.city, state: a.state, postalCode: a.postalCode,
      country: a.country, addressType: ['Home', 'Work', 'Other'].includes(a.addressType) ? a.addressType : 'Other' };
    this.customAddressType = ['Home', 'Work', 'Other'].includes(a.addressType) ? '' : a.addressType;
    this.normaliseKnownLocation();
    this.verifiedPincode = a.postalCode;
    this.pincodeError = '';
    this.showForm = true; this.resetValidation();
  }
  cancel(): void { if (!this.saving) { this.showForm = false; this.resetValidation(); } }

  addressTypeChanged(type: string): void {
    this.form.addressType = type;
    if (type !== 'Other') this.customAddressType = '';
  }

  get customAddressTypeError(): string {
    const value = this.customAddressType.trim();
    if (this.form.addressType !== 'Other') return '';
    if (value.length < 2 || value.length > 30 || !/[\p{L}\p{N}]/u.test(value)) return 'Enter an address type between 2 and 30 characters.';
    return '';
  }

  private resetValidation(): void { this.error = ''; this.attempted = false; this.touched.clear(); }

  get stateOptions(): string[] {
    return withLegacyOption(this.locations?.states.map(state => state.name) || [], this.legacyLocation?.state || '');
  }

  get cityOptions(): string[] {
    const cities = stateFor(this.locations, this.form.state)?.cities || [];
    const legacyCity = this.legacyLocation && this.form.state.toLocaleLowerCase('en-IN') === this.legacyLocation.state.toLocaleLowerCase('en-IN')
      ? this.legacyLocation.city : '';
    return withLegacyOption(cities, legacyCity);
  }

  get pincodeLocked(): boolean {
    return Boolean(this.verifiedPincode) && this.verifiedPincode === this.form.postalCode.trim();
  }

  stateChanged(state: string): void {
    if (this.pincodeLocked) return;
    this.form.state = state;
    this.form.city = '';
    this.touched.delete('city');
  }

  pincodeChanged(value: string): void {
    this.form.postalCode = value.replace(/\D/g, '').slice(0, 6);
    this.verifiedPincode = '';
    this.pincodeError = '';
    const request = ++this.pincodeRequest;
    if (this.form.postalCode.length !== 6) { this.pincodeLoading = false; return; }
    this.pincodeLoading = true;
    this.account.lookupPincode(this.form.postalCode).subscribe({
      next: location => {
        if (request !== this.pincodeRequest) return;
        this.form.postalCode = location.postalCode;
        this.form.state = location.state;
        this.form.city = location.city;
        this.verifiedPincode = location.postalCode;
        this.pincodeLoading = false;
        this.touched.delete('state'); this.touched.delete('city');
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

  private normaliseKnownLocation(): void {
    const location = canonicalLocation(this.locations, this.form.state, this.form.city);
    if (location) Object.assign(this.form, location);
  }

  fieldError(field: keyof AddressPayload): string {
    const value = String(this.form[field] || '').trim();
    const labels: Partial<Record<keyof AddressPayload, string>> = {
      fullName: 'Full name', phone: 'Phone number', email: 'Email address', addressLine1: 'Address line 1',
      city: 'City', state: 'State', postalCode: 'PIN code'
    };
    if (labels[field] && !value) return `${labels[field]} is required.`;
    if (field === 'phone' && !/^[6-9]\d{9}$/.test(value)) return 'Enter a valid 10-digit Indian mobile number.';
    if (field === 'email' && !/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(value)) return 'Enter a valid email address for shipment tracking.';
    if (field === 'postalCode' && !/^[1-9]\d{5}$/.test(value)) return 'Enter a valid 6-digit Indian PIN code.';
    if (field === 'postalCode' && this.pincodeError) return this.pincodeError;
    if (['fullName', 'city', 'state'].includes(field) && value.length < 2) return `Enter at least 2 characters for ${labels[field]?.toLowerCase()}.`;
    if (['fullName', 'city', 'state'].includes(field) && String(this.form[field]).length > 100) return 'Use no more than 100 characters.';
    if (field === 'addressLine1' && value.length < 5) return 'Enter a complete house, street and area.';
    if (['addressLine1', 'addressLine2', 'landmark'].includes(field) && String(this.form[field] || '').length > 255) return 'Use no more than 255 characters.';
    if (field === 'state' && this.locations && !stateFor(this.locations, value) && value !== this.legacyLocation?.state) {
      return 'Select a valid Indian state.';
    }
    if (field === 'city' && this.locations && value && this.form.state &&
        !canonicalLocation(this.locations, this.form.state, value) &&
        !sameLocation({ state: this.form.state, city: value }, this.legacyLocation)) {
      return 'Select a city that belongs to the selected state.';
    }
    return '';
  }

  visibleError(field: keyof AddressPayload): string {
    return this.attempted || this.touched.has(field) ? this.fieldError(field) : '';
  }

  save(): void {
    if (this.saving) return;
    this.attempted = true;
    this.error = '';
    if (!this.locations) {
      this.error = this.locationError || 'State and city options are still loading.';
      return;
    }
    if (this.customAddressTypeError) {
      this.error = this.customAddressTypeError;
      this.addressFormElement?.nativeElement.querySelector<HTMLElement>('[name="customAddressType"]')?.focus();
      return;
    }
    const fields: (keyof AddressPayload)[] = ['fullName', 'phone', 'email', 'addressLine1', 'addressLine2', 'landmark', 'city', 'state', 'postalCode'];
    const invalidField = fields.find(field => this.fieldError(field));
    if (invalidField) {
      const names: Partial<Record<keyof AddressPayload, string>> = { addressLine1: 'l1', addressLine2: 'l2', landmark: 'lm', postalCode: 'pin' };
      this.addressFormElement?.nativeElement.querySelector<HTMLElement>(`[name="${names[invalidField] || invalidField}"]`)?.focus();
      return;
    }
    if (this.pincodeLoading) { this.error = 'PIN code verification is still in progress.'; return; }
    if (this.verifiedPincode !== this.form.postalCode.trim()) { this.error = this.pincodeError || 'Please enter a valid Indian PIN code.'; return; }
    const payload = { ...this.form, addressType: this.form.addressType === 'Other' ? this.customAddressType.trim() : this.form.addressType };
    for (const field of fields) payload[field] = String(this.form[field] || '').trim();
    const canonical = canonicalLocation(this.locations, payload.state, payload.city);
    if (canonical) Object.assign(payload, canonical);
    this.saving = true; this.error = '';
    const req = this.editingId
      ? this.account.updateAddress(this.editingId, payload)
      : this.account.addAddress(payload);
    req.subscribe({
      next: () => { this.saving = false; this.showForm = false; this.load(); },
      error: (err) => { this.error = err?.error?.message || 'Could not save your address. Please try again.'; this.saving = false; }
    });
  }

  delete(id: string): void {
    if (!confirm('Delete this address?')) return;
    this.account.deleteAddress(id).subscribe(() => this.load());
  }

  setDefault(id: string): void {
    this.account.setDefaultAddress(id).subscribe(() => this.load());
  }
}
