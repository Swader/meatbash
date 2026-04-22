import {
  createClientId,
  type ClientMessage,
  type HostSnapshotMessage,
  type InputFrameMessage,
  type MatchStartMessage,
  type NetworkRole,
  type PeerJoinedMessage,
  type SerializedBeast,
  type ServerMessage,
} from './protocol';
import { WsClient } from './ws-client';

export interface NetworkMatchHooks {
  onStatus?: (message: string) => void;
  onDisconnected?: () => void;
  onRoomCreated?: (roomCode: string) => void;
  onWaitingForPeer?: (roomCode: string) => void;
  onJoinedRoom?: (roomCode: string) => void;
  onPeerJoined?: (roomCode: string, guestBeast: SerializedBeast) => void;
  onMatchStart?: (message: MatchStartMessage) => void;
  onInputFrame?: (frame: InputFrameMessage) => void;
  onSnapshot?: (snapshot: HostSnapshotMessage) => void;
  onPeerLeft?: () => void;
  onError?: (message: string) => void;
}

export class NetworkMatch {
  private readonly clientId = createClientId();
  private readonly ws = new WsClient({
    onMessage: (message) => this.handleMessage(message),
    onClose: () => {
      if (this.connected) {
        this.connected = false;
        this.role = null;
        this.roomCode = null;
        this.localBeast = null;
        this.hooks.onStatus?.('Disconnected.');
        this.hooks.onDisconnected?.();
      }
    },
  });

  private connected = false;
  private role: NetworkRole | null = null;
  private roomCode: string | null = null;
  private localBeast: SerializedBeast | null = null;

  constructor(
    private readonly wsUrl: string,
    private readonly hooks: NetworkMatchHooks = {}
  ) {}

  async host(localBeast: SerializedBeast): Promise<void> {
    await this.disconnect();
    try {
      await this.ensureConnected();
      this.localBeast = localBeast;
      this.role = 'host';
      this.send({
        type: 'create_room',
        beast: localBeast,
      });
      this.hooks.onStatus?.('Creating room...');
    } catch {
      this.connected = false;
      this.role = null;
      this.roomCode = null;
      this.localBeast = null;
      this.hooks.onError?.('Relay connection failed.');
      this.hooks.onStatus?.('Relay connection failed.');
    }
  }

  async join(roomCode: string, localBeast: SerializedBeast): Promise<void> {
    await this.disconnect();
    try {
      await this.ensureConnected();
      this.localBeast = localBeast;
      this.role = 'guest';
      this.send({
        type: 'join_room',
        roomCode,
        beast: localBeast,
      });
      this.hooks.onStatus?.(`Joining ${roomCode}...`);
    } catch {
      this.connected = false;
      this.role = null;
      this.roomCode = null;
      this.localBeast = null;
      this.hooks.onError?.('Relay connection failed.');
      this.hooks.onStatus?.('Relay connection failed.');
    }
  }

  sendSnapshot(snapshot: HostSnapshotMessage): void {
    if (this.role !== 'host') return;
    this.send(snapshot);
  }

  sendInput(frame: InputFrameMessage): void {
    if (this.role !== 'guest') return;
    this.send(frame);
  }

  sendMatchStart(hostBeast: SerializedBeast, guestBeast: SerializedBeast): void {
    if (this.role !== 'host' || !this.roomCode) return;
    this.send({
      type: 'match_start',
      roomCode: this.roomCode,
      startAtServerTime: Date.now(),
      hostBeast,
      guestBeast,
    });
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.send({ type: 'leave_room' });
    }
    this.connected = false;
    this.role = null;
    this.roomCode = null;
    this.localBeast = null;
    await this.ws.disconnect();
  }

  getState(): { role: NetworkRole | null; roomCode: string | null } {
    return {
      role: this.role,
      roomCode: this.roomCode,
    };
  }

  getLocalBeast(): SerializedBeast | null {
    return this.localBeast;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.ws.connect(this.wsUrl);
    this.connected = true;
    this.send({
      type: 'hello',
      clientId: this.clientId,
      protocolVersion: 1,
    });
  }

  private send(message: ClientMessage): void {
    this.ws.send(message);
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'room_created':
        this.roomCode = message.roomCode;
        this.hooks.onRoomCreated?.(message.roomCode);
        this.hooks.onWaitingForPeer?.(message.roomCode);
        this.hooks.onStatus?.(`Room ${message.roomCode} created. Waiting for guest...`);
        break;
      case 'room_joined':
        this.roomCode = message.roomCode;
        this.hooks.onJoinedRoom?.(message.roomCode);
        this.hooks.onStatus?.(`Joined ${message.roomCode}. Waiting for host...`);
        break;
      case 'peer_joined': {
        const payload = message as PeerJoinedMessage;
        if (!this.roomCode) break;
        this.hooks.onPeerJoined?.(this.roomCode, payload.beast);
        break;
      }
      case 'match_start':
        this.hooks.onMatchStart?.(message);
        break;
      case 'input_frame':
        this.hooks.onInputFrame?.(message);
        break;
      case 'host_snapshot':
        this.hooks.onSnapshot?.(message);
        break;
      case 'peer_left':
        if (this.role === 'guest') {
          this.role = null;
          this.roomCode = null;
          this.localBeast = null;
        }
        this.hooks.onPeerLeft?.();
        break;
      case 'error':
        this.hooks.onError?.(message.message);
        this.hooks.onStatus?.(message.message);
        break;
      case 'pong':
        break;
    }
  }
}
