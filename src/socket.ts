import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

let io: Server | null = null;

export const initSocket = (httpServer: HttpServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    console.log(`⚡ Socket connected: ${socket.id}`);

    socket.on('join_user', (userId: string) => {
      if (userId) {
        socket.join(`user_${userId}`);
        console.log(`Socket ${socket.id} joined room user_${userId}`);
      }
    });

    socket.on('join_admin', () => {
      socket.join('admin_room');
      console.log(`Socket ${socket.id} joined admin_room`);
    });

    socket.on('join_ticket', (ticketId: string) => {
      if (ticketId) {
        socket.join(`ticket_${ticketId}`);
        console.log(`Socket ${socket.id} joined room ticket_${ticketId}`);
      }
    });

    socket.on('leave_ticket', (ticketId: string) => {
      if (ticketId) {
        socket.leave(`ticket_${ticketId}`);
        console.log(`Socket ${socket.id} left room ticket_${ticketId}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};
