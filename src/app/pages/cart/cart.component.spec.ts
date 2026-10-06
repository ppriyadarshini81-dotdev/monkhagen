import { of } from 'rxjs';
import { Address, IndiaLocations } from '../../models/account.model';
import { AccountService } from '../../services/account.service';
import { CartComponent } from './cart.component';

describe('Cart address locations', () => {
  let component: CartComponent;
  let account: jasmine.SpyObj<AccountService>;
  const locations: IndiaLocations = { country: 'India', attribution: 'test', states: [
    { name: 'Haryana', cities: ['Faridabad', 'Gurugram'] },
    { name: 'Punjab', cities: ['Amritsar', 'Ludhiana'] }
  ] };

  beforeEach(() => {
    account = jasmine.createSpyObj<AccountService>('AccountService', ['getAddressLocations', 'lookupPincode', 'addAddress', 'updateAddress']);
    account.getAddressLocations.and.returnValue(of(locations));
    account.lookupPincode.and.returnValue(of({ postalCode: '122001', state: 'Haryana', city: 'Gurugram' }));
    account.addAddress.and.returnValue(of({ id: 'address-1', fullName: 'Test Customer', phone: '9876543210', email: 'test@example.com',
      addressLine1: '12 Test Street', city: 'Gurugram', state: 'Haryana', postalCode: '122001',
      country: 'India', addressType: 'Home', isDefault: false } as Address));
    account.updateAddress.and.returnValue(of({ id: 'address-1', fullName: 'Test Customer', phone: '9876543210', email: 'test@example.com',
      addressLine1: '12 Test Street', city: 'Gurugram', state: 'Haryana', postalCode: '122001',
      country: 'India', addressType: 'Home', isDefault: false } as Address));
    component = new CartComponent(
      { total: 1000, prepaidOffer: { eligible: false, discountAmount: 0 } } as never,
      account,
      { isLoggedIn: true } as never,
      {} as never,
      { track: () => undefined } as never,
      {} as never,
      {} as never,
      {} as never
    );
    component.ngOnInit();
    component.newAddress();
  });

  it('loads state-specific cities and clears the old city when state changes', () => {
    component.stateChanged('Haryana');
    expect(component.cityOptions).toEqual(['Faridabad', 'Gurugram']);
    component.shipping.city = 'Gurugram';
    component.stateChanged('Punjab');
    expect(component.shipping.city).toBe('');
    expect(component.cityOptions).toEqual(['Amritsar', 'Ludhiana']);
  });

  it('allows State and City to be selected before a PIN is entered', () => {
    expect(component.pincodeLocked).toBeFalse();
    component.stateChanged('Haryana');
    expect(component.shipping.state).toBe('Haryana');
    expect(component.cityOptions).toContain('Gurugram');
  });

  it('rejects a mismatched city and state before calling the address API', () => {
    component.shipping = { name: 'Test Customer', address: '12 Test Street', state: 'Haryana',
      addressLine2: '', landmark: '', city: 'Amritsar', zip: '122001', phone: '9876543210', email: 'test@example.com' };
    component.continueCheckout();
    expect(component.addressFieldError('city')).toContain('selected state');
    expect(account.addAddress).not.toHaveBeenCalled();
  });

  it('saves canonical city and state strings and continues checkout', () => {
    component.shipping = { name: 'Test Customer', address: '12 Test Street', state: 'haryana',
      addressLine2: '', landmark: '', city: 'gurugram', zip: '122001', phone: '9876543210', email: 'test@example.com' };
    component.pincodeChanged('122001');
    component.continueCheckout();
    expect(account.addAddress).toHaveBeenCalledWith(jasmine.objectContaining({
      state: 'Haryana', city: 'Gurugram', country: 'India'
    }));
    expect(component.checkoutStep).toBe('payment');
    expect(component.selectedAddressId).toBe('address-1');
  });

  it('does not continue checkout until a six-digit PIN has been verified', () => {
    component.shipping = { name: 'Test Customer', address: '12 Test Street', addressLine2: '', landmark: '', state: 'Haryana',
      city: 'Gurugram', zip: '122001', phone: '9876543210', email: 'test@example.com' };
    component.continueCheckout();
    expect(account.addAddress).not.toHaveBeenCalled();
    expect(component.pincodeError).toContain('valid Indian PIN');
  });

  it('edits a saved address in checkout instead of creating a duplicate', () => {
    const address = { id: 'address-1', fullName: 'Test Customer', phone: '9876543210', email: 'test@example.com',
      addressLine1: '12 Test Street', addressLine2: null, landmark: null, city: 'Gurugram', state: 'Haryana', postalCode: '122001',
      country: 'India', addressType: 'Home', isDefault: false } as Address;
    component.addresses = [address];
    component.editAddress(address);
    expect(component.editingAddressId).toBe(address.id);
    component.continueCheckout();
    expect(account.updateAddress).toHaveBeenCalledWith(address.id, jasmine.objectContaining({ postalCode: '122001' }));
    expect(account.addAddress).not.toHaveBeenCalled();
  });
});
