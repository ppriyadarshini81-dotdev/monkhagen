import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

// Attaches the stored JWT to outgoing /api requests.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = localStorage.getItem('mh_token');
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    const analyticsSession = sessionStorage.getItem('mh_analytics_session');
    const setHeaders: Record<string, string> = {};
    if (token) setHeaders['Authorization'] = `Bearer ${token}`;
    if (analyticsSession) setHeaders['X-MH-Analytics-Session'] = analyticsSession;
    req = req.clone({
      setHeaders
    });
  }
  return next(req).pipe(catchError(error => {
    // A revoked or expired server session must not leave the storefront showing
    // the customer as authenticated.
    if (token && (req.url === '/api' || req.url.startsWith('/api/')) && error?.status === 401) {
      auth.expireSession();
    }
    return throwError(() => error);
  }));
};
