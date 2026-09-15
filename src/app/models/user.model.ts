export interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: 'admin' | 'super_admin' | 'customer';
  profileImage: string | null;
  firebaseUid?: string | null;
  googleUid: string | null;
  dateOfBirth?: string | null;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  isActive?: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
  isNewUser?: boolean;
}
