export interface User {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: 'admin' | 'super_admin' | 'customer';
  profileImage: string | null;
  googleUid: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
  isNewUser?: boolean;
}
