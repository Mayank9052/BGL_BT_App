export interface UserProfile {
  id: number;
  azureObjectId: string;
  email: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  department: string | null;
  role: "Admin" | "Manager" | "User";
  isActive: boolean;
  lastLoginAt: string | null;
}