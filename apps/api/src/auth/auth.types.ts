import type { Request } from 'express';

export type AuthUser = {
  id: string;
  fullName: string;
  username: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
  role: 'EMPLOYEE' | 'PROCUREMENT' | 'ADMIN';
  status: 'PENDING' | 'ACTIVE' | 'BLOCKED';
  telegramChatId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JwtPayload = {
  sub: string;
  username: string;
  role: AuthUser['role'];
};

export type AuthenticatedRequest = Request & {
  authUser: AuthUser;
};
