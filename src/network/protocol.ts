import type { BeastDefinition } from '../beast/beast-data';
import type { AttackState, AttackVisualRigType, AttackProfile, ChargeTier } from '../combat/attack-types';

export type SerializedBeast = BeastDefinition;
export type NetworkRole = 'host' | 'guest';
export type SnapshotMatchPhase = 'COUNTDOWN' | 'FIGHTING' | 'ENDED';
export type SnapshotResult = NetworkRole | 'draw';

export interface HelloMessage {
  type: 'hello';
  clientId: string;
  protocolVersion: 1;
}

export interface CreateRoomMessage {
  type: 'create_room';
  beast: SerializedBeast;
}

export interface JoinRoomMessage {
  type: 'join_room';
  roomCode: string;
  beast: SerializedBeast;
}

export interface LeaveRoomMessage {
  type: 'leave_room';
}

export interface PingMessage {
  type: 'ping';
  sentAt: number;
}

export interface PongMessage {
  type: 'pong';
  sentAt: number;
}

export interface InputFrameMessage {
  type: 'input_frame';
  frame: number;
  keys: string[];
  edges?: {
    pressed: string[];
    released: string[];
  };
}

export interface MatchStartMessage {
  type: 'match_start';
  roomCode: string;
  startAtServerTime: number;
  hostBeast: SerializedBeast;
  guestBeast: SerializedBeast;
}

export interface RoomCreatedMessage {
  type: 'room_created';
  roomCode: string;
  role: 'host';
}

export interface RoomJoinedMessage {
  type: 'room_joined';
  roomCode: string;
  role: 'guest';
  hostBeast: SerializedBeast;
}

export interface PeerJoinedMessage {
  type: 'peer_joined';
  peerId: string;
  beast: SerializedBeast;
}

export interface PeerLeftMessage {
  type: 'peer_left';
  peerId: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface SerializedBeastState {
  player: NetworkRole;
  stamina: number;
  mass: number;
  attack: {
    state: AttackState;
    profile: AttackProfile;
    chargeNorm: number;
    chargeTier: ChargeTier;
    holdSeconds: number;
    isBlocking: boolean;
    stateProgress: number;
    visualRigType: AttackVisualRigType;
  };
  segments: Array<{
    name: string;
    attached: boolean;
    pos: [number, number, number];
    rot: [number, number, number, number];
  }>;
}

export type SerializedMatchEvent =
  | {
      type: 'damage';
      victim: NetworkRole;
      attacker?: NetworkRole;
      segment: string;
      amount: number;
      source: 'passive' | 'active';
      splashText: string;
      impactClass: string;
      point: [number, number, number];
      shake: number;
    }
  | {
      type: 'severance';
      beast: NetworkRole;
      segment: string;
      point: [number, number, number];
    }
  | {
      type: 'audio';
      beast: NetworkRole;
      name: string;
    };

export interface HostSnapshotMessage {
  type: 'host_snapshot';
  frame: number;
  serverTime: number;
  match: {
    phase: SnapshotMatchPhase;
    timer: number;
    result?: SnapshotResult;
  };
  beasts: SerializedBeastState[];
  events: SerializedMatchEvent[];
}

export type ClientMessage =
  | HelloMessage
  | CreateRoomMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | InputFrameMessage
  | HostSnapshotMessage
  | MatchStartMessage
  | PingMessage;

export type ServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | InputFrameMessage
  | HostSnapshotMessage
  | MatchStartMessage
  | ErrorMessage
  | PongMessage;

export function createClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `meat-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
