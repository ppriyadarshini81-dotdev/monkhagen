import { Component, OnInit } from '@angular/core';
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

  constructor(private account: AccountService) {}

  ngOnInit(): void { this.load(); }
  load(): void { this.account.getAddresses().subscribe(a => this.addresses = a); }

  openAdd(): void { this.editingId = null; this.form = EMPTY_FORM(); this.showForm = true; this.error = ''; }
  openEdit(a: Address): void {
    this.editingId = a.id;
    this.form = { fullName: a.fullName, phone: a.phone, addressLine1: a.addressLine1,
      addressLine2: a.addressLine2 || '', landmark: a.landmark || '',
      city: a.city, state: a.state, postalCode: a.postalCode,
      country: a.country, addressType: a.addressType };
    this.showForm = true; this.error = '';
  }
  cancel(): void { this.showForm = false; }

  save(): void {
    this.saving = true; this.error = '';
    const req = this.editingId
      ? this.account.updateAddress(this.editingId, this.form)
      : this.account.addAddress(this.form);
    req.subscribe({
      next: () => { this.saving = false; this.showForm = false; this.load(); },
      error: (err) => { this.error = err?.error?.message || 'Failed.'; this.saving = false; }
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
