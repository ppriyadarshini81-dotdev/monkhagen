import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { AccountAddressesComponent } from './addresses.component';
import { AccountService } from '../../../services/account.service';
import { Address, AddressPayload } from '../../../models/account.model';

describe('Address book validation', () => {
  let fixture: ComponentFixture<AccountAddressesComponent>;
  let account: jasmine.SpyObj<AccountService>;
  const valid: AddressPayload = { fullName: 'Test Customer', phone: '9876543210', addressLine1: '12 Test Street',
    city: 'Delhi', state: 'Delhi', postalCode: '110001', country: 'India', addressType: 'Home' };

  beforeEach(async () => {
    account = jasmine.createSpyObj('AccountService', ['getAddresses', 'addAddress', 'updateAddress']);
    account.getAddresses.and.returnValue(of([]));
    account.addAddress.and.returnValue(of({ ...valid, id: 'address-test' } as Address));
    account.updateAddress.and.returnValue(of({ ...valid, id: 'address-test' } as Address));
    await TestBed.configureTestingModule({ imports: [AccountAddressesComponent],
      providers: [{ provide: AccountService, useValue: account }] }).compileComponents();
    fixture = TestBed.createComponent(AccountAddressesComponent);
    fixture.detectChanges();
    fixture.componentInstance.openAdd();
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows six required-field messages on submit without sending an API request', () => {
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('.mh-field-error').length).toBe(0);
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(root.querySelectorAll('.mh-field-error').length).toBe(6);
    expect(account.addAddress).not.toHaveBeenCalled();
    expect(fixture.componentInstance.saving).toBeFalse();
  });

  it('shows errors on blur and clears them as the field becomes valid', () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('#addr-phone');
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fixture.componentInstance.form.phone = '9876543210';
    fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('rejects whitespace, incomplete address, invalid mobile and invalid PIN', () => {
    const component = fixture.componentInstance;
    for (const invalid of [{ fullName: '  ' }, { addressLine1: 'abc' }, { city: 'x' }, { state: ' ' },
      { phone: '1234567890' }, { phone: '987654321' }, { postalCode: '012345' }, { postalCode: '11000a' }]) {
      component.form = { ...valid, ...invalid };
      component.save();
    }
    expect(account.addAddress).not.toHaveBeenCalled();
  });

  it('trims a valid new address and allows empty optional fields', () => {
    fixture.componentInstance.form = { ...valid, fullName: ' Test Customer ', addressLine1: ' 12 Test Street ' };
    fixture.componentInstance.save();
    expect(account.addAddress).toHaveBeenCalledWith({ ...valid, addressLine2: '', landmark: '' });
    expect(fixture.componentInstance.showForm).toBeFalse();
  });

  it('validates edits and resets messages when cancelled or reopened', () => {
    const component = fixture.componentInstance;
    component.save();
    component.cancel();
    component.openEdit({ ...valid, id: 'address-test' } as Address);
    expect(component.attempted).toBeFalse();
    expect(component.touched.size).toBe(0);
    component.save();
    expect(account.updateAddress).toHaveBeenCalledWith('address-test', { ...valid, addressLine2: '', landmark: '' });
  });

  it('preserves input after API failure and prevents duplicate saves while pending', () => {
    const component = fixture.componentInstance;
    component.form = { ...valid };
    const pending = new Subject<Address>();
    account.addAddress.and.returnValue(pending);
    component.save();
    component.save();
    expect(account.addAddress).toHaveBeenCalledTimes(1);
    pending.error({ error: { message: 'Please try again.' } });
    expect(component.showForm).toBeTrue();
    expect(component.form).toEqual(valid);
    expect(component.error).toBe('Please try again.');
    expect(component.saving).toBeFalse();
  });
});
