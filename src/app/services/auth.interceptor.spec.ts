import { HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { authInterceptor } from './auth.interceptor';

describe('API authorization boundaries', () => {
  afterEach(() => localStorage.removeItem('mh_token'));
  it('attaches a token only to the application API path', () => {
    localStorage.setItem('mh_token', 'test-only-token');
    for (const url of ['/api', '/api/cart', '/api.evil.test', '/api-attacker', 'https://example.test/api/cart']) {
      let authorization: string | null = null;
      authInterceptor(new HttpRequest('GET', url), request => {
        authorization = request.headers.get('Authorization');
        return of(new HttpResponse());
      }).subscribe();
      expect<string | null>(authorization).toBe(url === '/api' || url.startsWith('/api/') ? 'Bearer test-only-token' : null);
    }
  });
});
