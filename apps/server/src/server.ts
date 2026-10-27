import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ClientToServerEvents, ServerToClientEvents } from '@jeopardy/shared';
import { Server } from 'socket.io';
import { createRequestHandler } from './http';
import { getLanAddresses } from './lan';
import { RoomManager } from './rooms/roomManager';
import type { RoomManagerOptions } from './rooms/roomManager';
import { attachSocketHandlers } from './socket';

export interface ServerOptions {
  port: number;
  host?: string;
  /** Built client to serve. null serves only the socket and the JSON endpoints. */
  staticDir?: string | null;
  rooms?: RoomManagerOptions;
}

export interface RunningServer {
  port: number;
  manager: RoomManager;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const manager = new RoomManager(options.rooms);

  const httpServer = createServer(
    createRequestHandler({
      staticDir: options.staticDir ?? null,
      info: () => ({ lanAddresses: getLanAddresses(), rooms: manager.roomCount }),
    }),
  );

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    serveClient: false,
    // Notice a dropped phone within ~15s instead of the default ~45s.
    pingInterval: 8000,
    pingTimeout: 7000,
    maxHttpBufferSize: 1_000_000,
  });
  attachSocketHandlers(io, manager);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host ?? '0.0.0.0', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  return {
    port: (httpServer.address() as AddressInfo).port,
    manager,
    io,
    async close() {
      manager.shutdown();
      await io.close();
    },
  };
}
