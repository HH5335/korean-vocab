// Express Request 类型增强：requireAuth 中间件会挂载当前登录用户
import type { User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};
