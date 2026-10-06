import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { AuthResponse, User } from '../models/user.model';

const TOKEN_KEY = 'mh_token';
const USER_KEY = 'mh_user';
const PROFILE_HINT_KEY = 'mh_show_profile_hint';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = '/api/auth';
  private userSubject = new BehaviorSubject<User | null>(this.readUser());
  user$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {}

  private readUser(): User | null {
    const raw = localStorage.getItem(USER_KEY);
    try { return raw ? this.normalizeUser(JSON.parse(raw) as User) : null; }
    catch { localStorage.removeItem(USER_KEY); return null; }
  }

  get currentUser(): User | null {
    return this.userSubject.value;
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  get isAdmin(): boolean {
    return ['admin', 'super_admin'].includes(this.currentUser?.role || '');
  }

  loginWithFirebase(idToken: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.api}/firebase`, { idToken })
      .pipe(tap((res) => this.persist(res)));
  }

  /** @deprecated Use loginWithFirebase for every Firebase provider. */
  loginWithGoogle(idToken: string): Observable<AuthResponse> {
    return this.loginWithFirebase(idToken);
  }

  sendOtp(phone: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.api}/otp/send`, { phone });
  }

  verifyOtp(phone: string, otp: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.api}/otp/verify`, { phone, otp })
      .pipe(tap((res) => this.persist(res)));
  }

  linkGoogleAccount(email: string, idToken: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.api}/link-google`, { email, idToken })
      .pipe(tap((res) => this.persist(res)));
  }
  sendEmailOtp(email: string): Observable<{ message: string; email: string; expiresInSeconds: number }> { return this.http.post<{ message: string; email: string; expiresInSeconds: number }>(`${this.api}/email-otp/send`, { email }); }
  verifyEmailOtp(email: string, otp: string): Observable<AuthResponse> { return this.http.post<AuthResponse>(`${this.api}/email-otp/verify`, { email, otp }).pipe(tap(res => this.persist(res))); }

  logout(): void {
    const token = this.token;
    if (token) this.http.post<void>(`${this.api}/logout`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    }).subscribe({ error: () => console.warn('Server sign-out could not be confirmed. The local session was cleared.') });
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(PROFILE_HINT_KEY);
    this.userSubject.next(null);
  }

  refreshUser(user: User): void {
    const normalized = this.normalizeUser(user);
    localStorage.setItem(USER_KEY, JSON.stringify(normalized));
    this.userSubject.next(normalized);
  }

  private persist(res: AuthResponse): void {
    const user = this.normalizeUser(res.user);
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    sessionStorage.setItem(PROFILE_HINT_KEY, '1');
    this.userSubject.next(user);
  }

  private normalizeUser(user: User): User {
    return user.name === 'Customer' && !user.email && !user.firebaseUid
      ? { ...user, name: 'User' }
      : user;
  }
}
