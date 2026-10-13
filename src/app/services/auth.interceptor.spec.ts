import { HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

describe('API authorization boundaries', () => {
  beforeEach(()=>TestBed.configureTestingModule({providers:[{provide:AuthService,useValue:{expireSession:()=>undefined}}]}));
  afterEach(() => localStorage.removeItem('mh_token'));
  it('attaches a token only to the application API path', () => {
    localStorage.setItem('mh_token', 'test-only-token');
    for (const url of ['/api', '/api/cart', '/api.evil.test', '/api-attacker', 'https://example.test/api/cart']) {
      let authorization: string | null = null;
      TestBed.runInInjectionContext(()=>authInterceptor(new HttpRequest('GET', url), request => {
        authorization = request.headers.get('Authorization');
        return of(new HttpResponse());
      }).subscribe());
      expect<string | null>(authorization).toBe(url === '/api' || url.startsWith('/api/') ? 'Bearer test-only-token' : null);
    }
  });
});
