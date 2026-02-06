export interface AuthUser {
  id: string;
  loginId: string;
  isSuperAdmin: boolean;
  departments: Array<{
    departmentId: string;
    departmentName: string;
    role: string;
    isPrimary: boolean;
  }>;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
