export interface User {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: 'admin' | 'customer';
}

export interface AuthResponse {
  token: string;
  user: User;
  isNewUser?: boolean;
}
