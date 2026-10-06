import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { AccountAddressesComponent } from './addresses.component';
import { AccountService } from '../../../services/account.service';
import { AuthService } from '../../../services/auth.service';
import { Address, AddressPayload, IndiaLocations } from '../../../models/account.model';

describe('Address book validation', () => {
  let fixture: ComponentFixture<AccountAddressesComponent>;
  let account: jasmine.SpyObj<AccountService>;
  const valid: AddressPayload = { fullName: 'Test Customer', phone: '9876543210', email: 'test@example.com', addressLine1: '12 Test Street',
    city: 'Delhi', state: 'Delhi', postalCode: '110001', country: 'India', addressType: 'Home' };
  const locations: IndiaLocations = { country: 'India', attribution: 'test', states: [
    { name: 'Delhi', cities: ['Delhi', 'New Delhi'] },
    { name: 'Haryana', cities: ['Faridabad', 'Gurugram'] },
    { name: 'Punjab', cities: ['Amritsar', 'Ludhiana'] }
  ] };

  beforeEach(async () => {
    account = jasmine.createSpyObj('AccountService', ['getAddresses', 'getAddressLocations', 'lookupPincode', 'addAddress', 'updateAddress']);
    account.getAddresses.and.returnValue(of([]));
    account.getAddressLocations.and.returnValue(of(locations));
    account.lookupPincode.and.returnValue(of({ postalCode: '110001', state: 'Delhi', city: 'Delhi' }));
    account.addAddress.and.returnValue(of({ ...valid, id: 'address-test' } as Address));
    account.updateAddress.and.returnValue(of({ ...valid, id: 'address-test' } as Address));
    await TestBed.configureTestingModule({ imports: [AccountAddressesComponent],
      providers: [{ provide: AccountService, useValue: account }, { provide: AuthService, useValue: { currentUser: null } }] }).compileComponents();
    fixture = TestBed.createComponent(AccountAddressesComponent);
    fixture.detectChanges();
    fixture.componentInstance.openAdd();
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows required-field messages on submit without sending an API request', () => {
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('.mh-field-error').length).toBe(0);
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(root.querySelectorAll('.mh-field-error').length).toBe(7);
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
      { phone: '1234567890' }, { phone: '987654321' }, { email: 'not-an-email' }, { postalCode: '012345' }, { postalCode: '11000a' }]) {
      component.form = { ...valid, ...invalid };
      component.save();
    }
    expect(account.addAddress).not.toHaveBeenCalled();
  });

  it('trims a valid new address and allows empty optional fields', () => {
    fixture.componentInstance.form = { ...valid, fullName: ' Test Customer ', addressLine1: ' 12 Test Street ' };
    fixture.componentInstance.pincodeChanged(valid.postalCode);
    fixture.componentInstance.save();
    expect(account.addAddress).toHaveBeenCalledWith({ ...valid, addressLine2: '', landmark: '' });
    expect(fixture.componentInstance.showForm).toBeFalse();
  });

  it('loads Indian states and dependent Haryana and Punjab cities', () => {
    const component = fixture.componentInstance;
    expect(component.stateOptions).toEqual(['Delhi', 'Haryana', 'Punjab']);
    component.stateChanged('Haryana');
    expect(component.cityOptions).toEqual(['Faridabad', 'Gurugram']);
    component.form.city = 'Gurugram';
    component.stateChanged('Punjab');
    expect(component.form.city).toBe('');
    expect(component.cityOptions).toEqual(['Amritsar', 'Ludhiana']);
  });

  it('keeps city disabled until a state is selected', async () => {
    let city: HTMLSelectElement = fixture.nativeElement.querySelector('#addr-city');
    expect(city.disabled).toBeTrue();
    const state: HTMLSelectElement = fixture.nativeElement.querySelector('#addr-state');
    state.value = 'Haryana';
    state.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    city = fixture.nativeElement.querySelector('#addr-city');
    expect(city.disabled).toBeFalse();
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
    component.pincodeChanged(valid.postalCode);
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

  it('loads and preserves a legacy saved city that is absent from the dataset', () => {
    const component = fixture.componentInstance;
    const legacy = { ...valid, id: 'legacy-address', state: 'Haryana', city: 'Legacy Township' } as Address;
    component.openEdit(legacy);
    expect(component.cityOptions).toContain('Legacy Township');
    component.save();
    expect(account.updateAddress).toHaveBeenCalledWith('legacy-address', jasmine.objectContaining({
      state: 'Haryana', city: 'Legacy Township'
    }));
  });

  it('uses the PIN lookup city and state and updates them when the PIN changes', () => {
    const component = fixture.componentInstance;
    account.lookupPincode.and.callFake((pin: string) => of(pin === '122001'
      ? { postalCode: '122001', state: 'Haryana', city: 'Gurugram' }
      : { postalCode: '110001', state: 'Delhi', city: 'New Delhi' }));
    component.pincodeChanged('110001');
    expect(component.form.state).toBe('Delhi');
    expect(component.form.city).toBe('New Delhi');
    component.pincodeChanged('122001');
    expect(component.form.state).toBe('Haryana');
    expect(component.form.city).toBe('Gurugram');
    expect(component.pincodeLoading).toBeFalse();
  });
});
