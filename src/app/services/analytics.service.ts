import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { AuthService } from './auth.service';

export type AnalyticsEventType =
  'PAGE_VIEW' | 'PRODUCT_VIEWED' | 'CART_VIEWED' | 'CHECKOUT_STARTED' |
  'ADDRESS_SELECTED' | 'PAYMENT_WINDOW_CLOSED' | 'ADD_TO_CART' |
  'REMOVE_FROM_CART' | 'FRONTEND_ERROR';

const VISITOR_KEY = 'mh_analytics_visitor';
const SESSION_KEY = 'mh_analytics_session';
const ACTIVITY_KEY = 'mh_analytics_activity';
const SESSION_USER_KEY = 'mh_analytics_session_user';
const SESSION_TIMEOUT = 30 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class AnalyticsService implements OnDestroy {
  private readonly api = '/api/analytics';
  private readonly visitorId: string;
  private sessionId: string;
  private readonly subscriptions = new Subscription();
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastActivity = Date.now();
  private lastMeasurement = Date.now();

  constructor(private http: HttpClient, router: Router, auth: AuthService) {
    this.visitorId = this.readOrCreate(localStorage, VISITOR_KEY);
    const previousActivity = Number(sessionStorage.getItem(ACTIVITY_KEY) || 0);
    if (!previousActivity || Date.now() - previousActivity > SESSION_TIMEOUT) {
      sessionStorage.removeItem(SESSION_KEY);
    }
    this.sessionId = this.readOrCreate(sessionStorage, SESSION_KEY);
    this.lastActivity = previousActivity || Date.now();
    this.lastMeasurement = Date.now();
    this.noteActivity();
    this.start(location.pathname);

    this.subscriptions.add(router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe(event => {
      this.noteActivity();
      this.track('PAGE_VIEW', event.urlAfterRedirects);
    }));
    this.subscriptions.add(auth.user$.subscribe(user => {
      const previousUser = sessionStorage.getItem(SESSION_USER_KEY);
      const nextUser = user?.id || null;
      // Logout starts a fresh anonymous session so later browsing is not
      // attributed to the account that just signed out. Login keeps the
      // current anonymous journey and safely associates it with that user.
      if (!nextUser && previousUser) {
        this.sessionId = this.uuid();
        sessionStorage.setItem(SESSION_KEY, this.sessionId);
        sessionStorage.removeItem(SESSION_USER_KEY);
        this.start(location.pathname);
      } else if (nextUser && previousUser && previousUser !== nextUser) {
        this.sessionId = this.uuid();
        sessionStorage.setItem(SESSION_KEY, this.sessionId);
        sessionStorage.setItem(SESSION_USER_KEY, nextUser);
        this.start(location.pathname);
      } else {
        if (nextUser) sessionStorage.setItem(SESSION_USER_KEY, nextUser);
        this.touch(false);
      }
    }));

    for (const name of ['pointerdown', 'keydown', 'touchstart'] as const) {
      document.addEventListener(name, this.activityListener, { passive: true });
    }
    document.addEventListener('visibilitychange', this.visibilityListener);
    window.addEventListener('pagehide', this.pageHideListener);
    window.addEventListener('error', this.errorListener);
    window.addEventListener('unhandledrejection', this.rejectionListener);
    this.heartbeat = setInterval(() => {
      if (!document.hidden && Date.now() - this.lastActivity < 90_000) this.touch(false);
      else this.lastMeasurement = Date.now();
    }, 30_000);
  }

  get currentSessionId(): string { return this.sessionId; }

  track(type: AnalyticsEventType, path = location.pathname, productId?: string,
    metadata?: Record<string, string | number>): void {
    const event = {
      eventId: this.uuid(), type,
      path: this.cleanPath(path),
      ...(productId ? { productId } : {}),
      ...(metadata ? { metadata } : {})
    };
    this.noteActivity();
    this.http.post(`${this.api}/events`, {
      sessionId: this.sessionId, visitorId: this.visitorId, events: [event]
    }).subscribe({ error: () => undefined });
  }

  private start(entryPath: string): void {
    this.http.post(`${this.api}/session`, {
      sessionId: this.sessionId,
      visitorId: this.visitorId,
      entryPath: this.cleanPath(entryPath)
    }).subscribe({ error: () => undefined });
  }

  private touch(ended: boolean, forceActive = false): void {
    const activeSeconds = this.consumeActiveSeconds(forceActive);
    this.http.post(`${this.api}/session/touch`, {
      sessionId: this.sessionId, visitorId: this.visitorId, ended,
      activeSeconds, exitPath: this.cleanPath(location.pathname)
    }).subscribe({ error: () => undefined });
  }

  private readonly activityListener = (): void => this.noteActivity();
  private readonly visibilityListener = (): void => {
    if (document.hidden) this.touch(false, true);
    else { this.lastMeasurement = Date.now(); this.noteActivity(); this.touch(false); }
  };
  private readonly pageHideListener = (): void => {
    const body = JSON.stringify({ sessionId: this.sessionId, visitorId: this.visitorId, ended: true,
      activeSeconds: this.consumeActiveSeconds(true), exitPath: this.cleanPath(location.pathname) });
    navigator.sendBeacon(`${this.api}/session/touch`, new Blob([body], { type: 'application/json' }));
  };
  private readonly errorListener = (event: ErrorEvent): void => {
    this.trackError('javascript_error', event.message || event.error?.name || 'Frontend error');
  };
  private readonly rejectionListener = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;
    this.trackError('unhandled_promise', typeof reason === 'string' ? reason : reason?.message || 'Unhandled promise rejection');
  };

  private trackError(category: string, message: string): void {
    const safe = String(message || 'Frontend error').replace(/https?:\/\/\S+/gi, '[url]')
      .replace(/[?&][^\s=]{1,40}=[^\s&]{1,200}/g, '[query]')
      .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').replace(/\s+/g, ' ').slice(0, 240);
    this.track('FRONTEND_ERROR', location.pathname, undefined, { category, message: safe });
  }

  private noteActivity(): void {
    const now = Date.now();
    if (now - this.lastActivity > SESSION_TIMEOUT) {
      this.sessionId = this.uuid();
      sessionStorage.setItem(SESSION_KEY, this.sessionId);
      this.lastMeasurement = now;
      this.start(location.pathname);
    }
    this.lastActivity = now;
    sessionStorage.setItem(ACTIVITY_KEY, String(this.lastActivity));
  }

  private consumeActiveSeconds(forceActive = false): number {
    const now = Date.now();
    const recentlyActive = now - this.lastActivity < 90_000;
    const seconds = ((forceActive || !document.hidden) && recentlyActive)
      ? Math.max(0, Math.min(60, Math.floor((now - this.lastMeasurement) / 1000))) : 0;
    this.lastMeasurement = now;
    return seconds;
  }

  private cleanPath(value: string): string {
    const path = value.split(/[?#]/, 1)[0];
    return path.startsWith('/') && !path.startsWith('//') ? path.slice(0, 512) : '/';
  }

  private readOrCreate(storage: Storage, key: string): string {
    const existing = storage.getItem(key);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const value = this.uuid();
    storage.setItem(key, value);
    return value;
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const value = Math.floor(Math.random() * 16);
      return (char === 'x' ? value : (value & 0x3) | 8).toString(16);
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const name of ['pointerdown', 'keydown', 'touchstart'] as const) {
      document.removeEventListener(name, this.activityListener);
    }
    document.removeEventListener('visibilitychange', this.visibilityListener);
    window.removeEventListener('pagehide', this.pageHideListener);
    window.removeEventListener('error', this.errorListener);
    window.removeEventListener('unhandledrejection', this.rejectionListener);
  }
}
