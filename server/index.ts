import type {
  ClientMessage,
  CreateRoomMessage,
  HostSnapshotMessage,
  InputFrameMessage,
  JoinRoomMessage,
  MatchStartMessage,
  SerializedBeast,
} from '../src/network/protocol';
import { isClientMessage } from '../src/network/protocol';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10) || 3001;
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_MESSAGE_BYTES = 64_000;

type SocketData = {
  id: string;
  roomCode: string | null;
  role: 'host' | 'guest' | null;
};

type Room = {
  code: string;
  host: ServerWebSocket<SocketData>;
  guest: ServerWebSocket<SocketData> | null;
  hostBeast: SerializedBeast;
  guestBeast: SerializedBeast | null;
};

const rooms = new Map<string, Room>();

const server = Bun.serve<SocketData>({
  hostname: HOST,
  port: PORT,
  fetch(req, serverInstance) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const id = crypto.randomUUID();
      if (serverInstance.upgrade(req, { data: { id, roomCode: null, role: null } })) {
        return;
      }
      return new Response('Upgrade failed', { status: 400 });
    }
    return new Response('MEATBASH room relay', { status: 200 });
  },
  websocket: {
    message(socket, raw) {
      const rawText = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
      if (rawText.length > MAX_MESSAGE_BYTES) {
        socket.send(JSON.stringify({ type: 'error', message: 'Message too large.' }));
        return;
      }

      const message = parseClientMessage(rawText);
      if (!message) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message.' }));
        return;
      }

      try {
        switch (message.type) {
          case 'hello':
            break;
          case 'create_room':
            handleCreateRoom(socket, message);
            break;
          case 'join_room':
            handleJoinRoom(socket, message);
            break;
          case 'leave_room':
            leaveRoom(socket);
            break;
          case 'input_frame':
            relayToHost(socket, message);
            break;
          case 'host_snapshot':
            relayToGuest(socket, message);
            break;
          case 'match_start':
            relayToGuest(socket, message);
            break;
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong', sentAt: message.sentAt }));
            break;
        }
      } catch (err) {
        console.error('Relay message handling failed:', err);
        socket.send(JSON.stringify({ type: 'error', message: 'Relay failed to process message.' }));
      }
    },
    close(socket) {
      leaveRoom(socket);
    },
  },
});

console.log(`🥩 MEATBASH relay listening on ws://${HOST}:${server.port}/ws`);

function handleCreateRoom(socket: ServerWebSocket<SocketData>, message: CreateRoomMessage): void {
  leaveRoom(socket);
  const roomCode = createRoomCode();
  const room: Room = {
    code: roomCode,
    host: socket,
    guest: null,
    hostBeast: message.beast,
    guestBeast: null,
  };
  rooms.set(roomCode, room);
  socket.data.roomCode = roomCode;
  socket.data.role = 'host';
  socket.send(JSON.stringify({ type: 'room_created', roomCode, role: 'host' }));
}

function handleJoinRoom(socket: ServerWebSocket<SocketData>, message: JoinRoomMessage): void {
  leaveRoom(socket);
  const room = rooms.get(message.roomCode);
  if (!room) {
    socket.send(JSON.stringify({ type: 'error', message: `Room ${message.roomCode} not found.` }));
    return;
  }
  if (room.guest) {
    socket.send(JSON.stringify({ type: 'error', message: `Room ${message.roomCode} is full.` }));
    return;
  }
  room.guest = socket;
  room.guestBeast = message.beast;
  socket.data.roomCode = room.code;
  socket.data.role = 'guest';
  socket.send(JSON.stringify({
    type: 'room_joined',
    roomCode: room.code,
    role: 'guest',
    hostBeast: room.hostBeast,
  }));
  room.host.send(JSON.stringify({
    type: 'peer_joined',
    peerId: socket.data.id,
    beast: message.beast,
  }));
}

function relayToHost(socket: ServerWebSocket<SocketData>, message: InputFrameMessage): void {
  const room = getRoomForSocket(socket);
  if (!room || socket.data.role !== 'guest') return;
  room.host.send(JSON.stringify(message));
}

function relayToGuest(
  socket: ServerWebSocket<SocketData>,
  message: HostSnapshotMessage | MatchStartMessage
): void {
  const room = getRoomForSocket(socket);
  if (!room || socket.data.role !== 'host' || !room.guest) return;
  room.guest.send(JSON.stringify(message));
}

function leaveRoom(socket: ServerWebSocket<SocketData>): void {
  const room = getRoomForSocket(socket);
  if (!room) {
    socket.data.roomCode = null;
    socket.data.role = null;
    return;
  }

  const role = socket.data.role;
  socket.data.roomCode = null;
  socket.data.role = null;

  if (role === 'host') {
    if (room.guest) {
      room.guest.send(JSON.stringify({ type: 'peer_left', peerId: socket.data.id }));
      room.guest.data.roomCode = null;
      room.guest.data.role = null;
    }
    rooms.delete(room.code);
    return;
  }

  room.guest = null;
  room.guestBeast = null;
  room.host.send(JSON.stringify({ type: 'peer_left', peerId: socket.data.id }));
}

function getRoomForSocket(socket: ServerWebSocket<SocketData>): Room | null {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return null;
  return rooms.get(roomCode) ?? null;
}

function createRoomCode(): string {
  let code = '';
  do {
    code = `MEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  } while (rooms.has(code));
  return code;
}

function parseClientMessage(rawText: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  return isClientMessage(parsed) ? parsed : null;
}
