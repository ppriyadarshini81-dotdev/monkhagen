import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AccountService } from '../../../services/account.service';
import { Address, AddressPayload } from '../../../models/account.model';

const EMPTY_FORM = (): AddressPayload => ({
  fullName: '', phone: '', addressLine1: '', addressLine2: '',
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
  saving = false;
  error = '';
  attempted = false;
  touched = new Set<keyof AddressPayload>();
  @ViewChild('addressFormElement', { read: ElementRef }) addressFormElement?: ElementRef<HTMLFormElement>;

  constructor(private account: AccountService) {}

  ngOnInit(): void { this.load(); }
  load(): void { this.account.getAddresses().subscribe(a => this.addresses = a); }

  openAdd(): void { this.editingId = null; this.form = EMPTY_FORM(); this.showForm = true; this.resetValidation(); }
  openEdit(a: Address): void {
    this.editingId = a.id;
    this.form = { fullName: a.fullName, phone: a.phone, addressLine1: a.addressLine1,
      addressLine2: a.addressLine2 || '', landmark: a.landmark || '',
      city: a.city, state: a.state, postalCode: a.postalCode,
      country: a.country, addressType: a.addressType };
    this.showForm = true; this.resetValidation();
  }
  cancel(): void { if (!this.saving) { this.showForm = false; this.resetValidation(); } }

  private resetValidation(): void { this.error = ''; this.attempted = false; this.touched.clear(); }

  fieldError(field: keyof AddressPayload): string {
    const value = String(this.form[field] || '').trim();
    const labels: Partial<Record<keyof AddressPayload, string>> = {
      fullName: 'Full name', phone: 'Phone number', addressLine1: 'Address line 1',
      city: 'City', state: 'State', postalCode: 'PIN code'
    };
    if (labels[field] && !value) return `${labels[field]} is required.`;
    if (field === 'phone' && !/^[6-9]\d{9}$/.test(value)) return 'Enter a valid 10-digit Indian mobile number.';
    if (field === 'postalCode' && !/^[1-9]\d{5}$/.test(value)) return 'Enter a valid 6-digit Indian PIN code.';
    if (['fullName', 'city', 'state'].includes(field) && value.length < 2) return `Enter at least 2 characters for ${labels[field]?.toLowerCase()}.`;
    if (['fullName', 'city', 'state'].includes(field) && String(this.form[field]).length > 100) return 'Use no more than 100 characters.';
    if (field === 'addressLine1' && value.length < 5) return 'Enter a complete house, street and area.';
    if (['addressLine1', 'addressLine2', 'landmark'].includes(field) && String(this.form[field] || '').length > 255) return 'Use no more than 255 characters.';
    return '';
  }

  visibleError(field: keyof AddressPayload): string {
    return this.attempted || this.touched.has(field) ? this.fieldError(field) : '';
  }

  save(): void {
    if (this.saving) return;
    this.attempted = true;
    this.error = '';
    const fields: (keyof AddressPayload)[] = ['fullName', 'phone', 'addressLine1', 'addressLine2', 'landmark', 'city', 'state', 'postalCode'];
    const invalidField = fields.find(field => this.fieldError(field));
    if (invalidField) {
      const names: Partial<Record<keyof AddressPayload, string>> = { addressLine1: 'l1', addressLine2: 'l2', landmark: 'lm', postalCode: 'pin' };
      this.addressFormElement?.nativeElement.querySelector<HTMLElement>(`[name="${names[invalidField] || invalidField}"]`)?.focus();
      return;
    }
    const payload = { ...this.form };
    for (const field of fields) payload[field] = String(this.form[field] || '').trim();
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
