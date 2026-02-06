import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

export function auditLog(action: string, entityType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      const actorUserId = req.user?.id ?? null;
      const entityId = req.params.id ?? '';
      const beforeJson = res.locals.auditBefore ?? null;
      const afterJson = res.locals.auditAfter ?? null;
      const ip =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
        req.socket.remoteAddress ??
        '';
      const userAgent = req.headers['user-agent'] ?? '';

      prisma.auditLog
        .create({
          data: { actorUserId, action, entityType, entityId, beforeJson, afterJson, ip, userAgent },
        })
        .catch((err) => {
          console.error('[AuditLog] 기록 실패:', err.message);
        });
    });

    next();
  };
}
