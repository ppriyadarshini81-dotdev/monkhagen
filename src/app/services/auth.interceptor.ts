import { HttpInterceptorFn } from '@angular/common/http';

// Attaches the stored JWT to outgoing /api requests.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
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
  return next(req);
};
