import { HttpInterceptorFn } from '@angular/common/http';

// Attaches the stored JWT to outgoing /api requests.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('mh_token');
  if (token && req.url.startsWith('/api')) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  }
  return next(req);
};
