import { Injectable } from '@angular/core';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup
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

  /** Signs out from Firebase (clears the local Firebase session). */
  async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}
