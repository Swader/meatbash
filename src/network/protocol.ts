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
    countdownSec?: number;
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

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isQuat(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber);
}

function isNetworkRole(value: unknown): value is NetworkRole {
  return value === 'host' || value === 'guest';
}

function isSnapshotMatchPhase(value: unknown): value is SnapshotMatchPhase {
  return value === 'COUNTDOWN' || value === 'FIGHTING' || value === 'ENDED';
}

function isSnapshotResult(value: unknown): value is SnapshotResult {
  return value === 'draw' || isNetworkRole(value);
}

function isAttackState(value: unknown): value is AttackState {
  return value === 'IDLE' || value === 'WINDUP' || value === 'HELD' || value === 'COMMIT' || value === 'RECOVER';
}

function isAttackProfile(value: unknown): value is AttackProfile {
  return value === 'blunt' || value === 'spike' || value === 'shield';
}

function isChargeTier(value: unknown): value is ChargeTier {
  return value === 'quick' || value === 'ready' || value === 'heavy';
}

function isAttackVisualRigType(value: unknown): value is AttackVisualRigType {
  return value === 'generic' ||
    value === 'overhand_smash' ||
    value === 'arm_chain_spike' ||
    value === 'forequarters_shove' ||
    value === 'headbutt_lunge';
}

function isSerializedAttackState(value: unknown): value is SerializedBeastState['attack'] {
  return isRecord(value) &&
    isAttackState(value.state) &&
    isAttackProfile(value.profile) &&
    isFiniteNumber(value.chargeNorm) &&
    isChargeTier(value.chargeTier) &&
    isFiniteNumber(value.holdSeconds) &&
    isBoolean(value.isBlocking) &&
    isFiniteNumber(value.stateProgress) &&
    isAttackVisualRigType(value.visualRigType);
}

function isSerializedSegmentState(
  value: unknown
): value is SerializedBeastState['segments'][number] {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    isBoolean(value.attached) &&
    isVec3(value.pos) &&
    isQuat(value.rot);
}

export function isSerializedBeast(value: unknown): value is SerializedBeast {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    (value.archetype === 'bipedal' || value.archetype === 'quadruped') &&
    typeof value.isDefault === 'boolean' &&
    typeof value.personality === 'string' &&
    isRecord(value.visuals) &&
    isFiniteNumber(value.visuals.color) &&
    isFiniteNumber(value.visuals.emissive);
}

export function isInputFrameMessage(value: unknown): value is InputFrameMessage {
  return isRecord(value) &&
    value.type === 'input_frame' &&
    isFiniteNumber(value.frame) &&
    isStringArray(value.keys) &&
    (
      value.edges === undefined ||
      (
        isRecord(value.edges) &&
        isStringArray(value.edges.pressed) &&
        isStringArray(value.edges.released)
      )
    );
}

export function isMatchStartMessage(value: unknown): value is MatchStartMessage {
  return isRecord(value) &&
    value.type === 'match_start' &&
    typeof value.roomCode === 'string' &&
    isFiniteNumber(value.startAtServerTime) &&
    isSerializedBeast(value.hostBeast) &&
    isSerializedBeast(value.guestBeast);
}

export function isSerializedBeastState(value: unknown): value is SerializedBeastState {
  return isRecord(value) &&
    isNetworkRole(value.player) &&
    isFiniteNumber(value.stamina) &&
    isFiniteNumber(value.mass) &&
    isSerializedAttackState(value.attack) &&
    Array.isArray(value.segments) &&
    value.segments.every(isSerializedSegmentState);
}

export function isSerializedMatchEvent(value: unknown): value is SerializedMatchEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'damage':
      return isNetworkRole(value.victim) &&
        (value.attacker === undefined || isNetworkRole(value.attacker)) &&
        typeof value.segment === 'string' &&
        isFiniteNumber(value.amount) &&
        (value.source === 'passive' || value.source === 'active') &&
        typeof value.splashText === 'string' &&
        typeof value.impactClass === 'string' &&
        isVec3(value.point) &&
        isFiniteNumber(value.shake);
    case 'severance':
      return isNetworkRole(value.beast) &&
        typeof value.segment === 'string' &&
        isVec3(value.point);
    case 'audio':
      return isNetworkRole(value.beast) &&
        typeof value.name === 'string';
    default:
      return false;
  }
}

export function isHostSnapshotMessage(value: unknown): value is HostSnapshotMessage {
  return isRecord(value) &&
    value.type === 'host_snapshot' &&
    isFiniteNumber(value.frame) &&
    isFiniteNumber(value.serverTime) &&
    isRecord(value.match) &&
    isSnapshotMatchPhase(value.match.phase) &&
    isFiniteNumber(value.match.timer) &&
    (value.match.countdownSec === undefined || isFiniteNumber(value.match.countdownSec)) &&
    (value.match.result === undefined || isSnapshotResult(value.match.result)) &&
    Array.isArray(value.beasts) &&
    value.beasts.every(isSerializedBeastState) &&
    Array.isArray(value.events) &&
    value.events.every(isSerializedMatchEvent);
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'hello':
      return typeof value.clientId === 'string' && value.protocolVersion === 1;
    case 'create_room':
      return isSerializedBeast(value.beast);
    case 'join_room':
      return typeof value.roomCode === 'string' && isSerializedBeast(value.beast);
    case 'leave_room':
      return true;
    case 'input_frame':
      return isInputFrameMessage(value);
    case 'host_snapshot':
      return isHostSnapshotMessage(value);
    case 'match_start':
      return isMatchStartMessage(value);
    case 'ping':
      return isFiniteNumber(value.sentAt);
    default:
      return false;
  }
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'room_created':
      return typeof value.roomCode === 'string' && value.role === 'host';
    case 'room_joined':
      return typeof value.roomCode === 'string' &&
        value.role === 'guest' &&
        isSerializedBeast(value.hostBeast);
    case 'peer_joined':
      return typeof value.peerId === 'string' && isSerializedBeast(value.beast);
    case 'peer_left':
      return typeof value.peerId === 'string';
    case 'input_frame':
      return isInputFrameMessage(value);
    case 'host_snapshot':
      return isHostSnapshotMessage(value);
    case 'match_start':
      return isMatchStartMessage(value);
    case 'error':
      return typeof value.message === 'string';
    case 'pong':
      return isFiniteNumber(value.sentAt);
    default:
      return false;
  }
}
