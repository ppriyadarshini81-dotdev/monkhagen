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
    account = jasmine.createSpyObj<AccountService>('AccountService', ['getAddressLocations', 'addAddress']);
    account.getAddressLocations.and.returnValue(of(locations));
    account.addAddress.and.returnValue(of({ id: 'address-1', fullName: 'Test Customer', phone: '9876543210',
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

  it('rejects a mismatched city and state before calling the address API', () => {
    component.shipping = { name: 'Test Customer', address: '12 Test Street', state: 'Haryana',
      city: 'Amritsar', zip: '122001', phone: '9876543210' };
    component.continueCheckout();
    expect(component.addressFieldError('city')).toContain('selected state');
    expect(account.addAddress).not.toHaveBeenCalled();
  });

  it('saves canonical city and state strings and continues checkout', () => {
    component.shipping = { name: 'Test Customer', address: '12 Test Street', state: 'haryana',
      city: 'gurugram', zip: '122001', phone: '9876543210' };
    component.continueCheckout();
    expect(account.addAddress).toHaveBeenCalledWith(jasmine.objectContaining({
      state: 'Haryana', city: 'Gurugram', country: 'India'
    }));
    expect(component.checkoutStep).toBe('payment');
    expect(component.selectedAddressId).toBe('address-1');
  });
});
