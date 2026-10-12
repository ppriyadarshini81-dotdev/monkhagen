import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { AccountService } from '../../../services/account.service';
import { ReturnRequest } from '../../../models/account.model';
import { AccountReturnsComponent } from './returns.component';

describe('AccountReturnsComponent order filter', () => {
  it('keeps order scope across pagination and status changes, and clears it when navigating to all requests', () => {
    const params = new BehaviorSubject(convertToParamMap({ orderId: 'first-order' }));
    const account = jasmine.createSpyObj<AccountService>('AccountService', ['getReturns']);
    account.getReturns.and.returnValue(of([]));
    const component = new AccountReturnsComponent(account, { queryParamMap: params.asObservable() } as ActivatedRoute);
    spyOn(window, 'scrollTo');
    component.ngOnInit(); expect(account.getReturns.calls.mostRecent().args).toEqual([10, 0, '', 'first-order']);
    component.hasNextPage = true; component.changePage(1);
    expect(account.getReturns.calls.mostRecent().args).toEqual([10, 10, '', 'first-order']);
    component.statusFilter = 'open'; component.applyStatusFilter();
    expect(account.getReturns.calls.mostRecent().args).toEqual([10, 0, 'open', 'first-order']);
    params.next(convertToParamMap({ orderId: 'second-order' }));
    expect(account.getReturns.calls.mostRecent().args).toEqual([10, 0, 'open', 'second-order']);
    params.next(convertToParamMap({}));
    expect(account.getReturns.calls.mostRecent().args).toEqual([10, 0, 'open', '']);
    const count = account.getReturns.calls.count(); component.ngOnDestroy();
    params.next(convertToParamMap({ orderId: 'first-order' }));
    expect(account.getReturns.calls.count()).toBe(count);
  });

  it('ignores a previous order response after switching to a different order', () => {
    const params = new BehaviorSubject(convertToParamMap({ orderId: 'first-order' }));
    const first = new Subject<ReturnRequest[]>(), second = new Subject<ReturnRequest[]>();
    const account = jasmine.createSpyObj<AccountService>('AccountService', ['getReturns']);
    account.getReturns.and.returnValues(first, second);
    const component = new AccountReturnsComponent(account, { queryParamMap: params.asObservable() } as ActivatedRoute);
    component.ngOnInit(); params.next(convertToParamMap({ orderId: 'second-order' }));
    const expected = [{ orderId: 'second-order' } as ReturnRequest];
    second.next(expected); first.next([{ orderId: 'first-order' } as ReturnRequest]);
    expect(component.returns).toEqual(expected); component.ngOnDestroy();
  });
});
