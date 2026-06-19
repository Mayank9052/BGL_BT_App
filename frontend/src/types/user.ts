export interface UserProfile {
  id: number;
  email: string;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  phoneNumber?: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt?: string | null;
}