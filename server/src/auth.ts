// 认证工具：scrypt 密码哈希 + 数据库会话 token（零第三方依赖）
import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(plain, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function extractBearerToken(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

/** 认证守卫：校验 Bearer token → 挂 req.user；过期会话自动删除，剩余不足一半时滑动续期 */
export function requireAuth(prisma: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = extractBearerToken(req);
      if (!token) return res.status(401).json({ error: '未登录' });
      const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
      if (!session || session.expiresAt.getTime() < Date.now()) {
        if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
        return res.status(401).json({ error: '登录已过期，请重新登录' });
      }
      if (session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS / 2) {
        await prisma.session
          .update({
            where: { id: session.id },
            data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
          })
          .catch(() => {});
      }
      req.user = session.user;
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** 管理员守卫：须在 requireAuth 之后使用 */
export function requireAdmin(): RequestHandler {
  return (req, res, next) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: '需要管理员权限' });
    next();
  };
}
