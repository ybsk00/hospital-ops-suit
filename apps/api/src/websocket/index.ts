import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

interface AuthUser {
  id: string;
  loginId: string;
  isSuperAdmin: boolean;
  departments: Array<{
    departmentId: string;
    role: string;
    isPrimary: boolean;
  }>;
}

interface AuthSocket extends Socket {
  user?: AuthUser;
}

let io: Server;

export function initWebSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
    path: '/ws',
  });

  // JWT authentication middleware
  io.use((socket: AuthSocket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as AuthUser;
      socket.user = decoded;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthSocket) => {
    const user = socket.user!;

    // Join user-specific room
    socket.join(`user:${user.id}`);

    // Join department rooms
    user.departments.forEach((dept) => {
      socket.join(`dept:${dept.departmentId}`);
    });

    // Join admin room if super admin
    if (user.isSuperAdmin) {
      socket.join('admins');
    }

    console.log(`[WS] Connected: ${user.loginId} (${user.id})`);

    socket.on('disconnect', () => {
      console.log(`[WS] Disconnected: ${user.loginId}`);
    });
  });

  return io;
}

// Emit helpers
export function emitToUser(userId: string, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, data);
}

export function emitToDepartment(departmentId: string, event: string, data: unknown): void {
  io?.to(`dept:${departmentId}`).emit(event, data);
}

export function emitToAll(event: string, data: unknown): void {
  io?.emit(event, data);
}

export function getIO(): Server {
  return io;
}
