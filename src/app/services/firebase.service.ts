import { Injectable } from '@angular/core';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  Auth,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile
} from 'firebase/auth';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private readonly firebaseApp: FirebaseApp;
  private readonly auth: Auth;

  constructor() {
    this.firebaseApp = getApps().length ? getApps()[0] : initializeApp(environment.firebase);
    this.auth = getAuth(this.firebaseApp);
  }

  /** Opens the Google sign-in popup and returns the Firebase ID token. */
  async signInWithGoogle(): Promise<string> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(this.auth, provider);
    return result.user.getIdToken();
  }

  /** Creates a Firebase password account and sends its verification email. */
  async createEmailAccount(name: string, email: string, password: string): Promise<void> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    try {
      await updateProfile(credential.user, { displayName: name });
      await sendEmailVerification(credential.user);
    } finally {
      await this.auth.signOut();
    }
  }

  /** Signs in a verified email/password user and returns a fresh Firebase ID token. */
  async signInWithEmail(email: string, password: string): Promise<string> {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    await credential.user.reload();

    if (!credential.user.emailVerified) {
      try {
        await sendEmailVerification(credential.user);
      } catch {
        // A previous verification email may still be valid; never leave an
        // unverified Firebase session active in the browser.
      } finally {
        await this.auth.signOut();
      }
      const error = new Error('Please verify your email. We sent you a new verification link.');
      Object.assign(error, { code: 'auth/email-not-verified' });
      throw error;
    }

    return credential.user.getIdToken(true);
  }

  async sendPasswordReset(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(this.auth, email);
    } catch (error: unknown) {
      const code = typeof error === 'object' && error && 'code' in error
        ? (error as { code?: unknown }).code
        : '';
      // Keep the response identical whether or not an account exists.
      if (code !== 'auth/user-not-found') throw error;
    }
  }

  /** Signs out from Firebase (clears the local Firebase session). */
  async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}
