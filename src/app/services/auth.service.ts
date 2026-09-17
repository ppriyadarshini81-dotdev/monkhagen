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
    return raw ? (JSON.parse(raw) as User) : null;
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

  /** @deprecated OTP login replaced by Google auth */
  sendOtp(phone: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.api}/send-otp`, { phone });
  }

  /** @deprecated OTP login replaced by Google auth */
  verifyOtp(phone: string, otp: string, name?: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.api}/verify-otp`, { phone, otp, name })
      .pipe(tap((res) => this.persist(res)));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(PROFILE_HINT_KEY);
    this.userSubject.next(null);
  }

  refreshUser(user: User): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.userSubject.next(user);
  }

  private persist(res: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    sessionStorage.setItem(PROFILE_HINT_KEY, '1');
    this.userSubject.next(res.user);
  }
}
