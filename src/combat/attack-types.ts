export type AttackProfile = 'blunt' | 'spike' | 'shield';
export type AttackState = 'IDLE' | 'WINDUP' | 'HELD' | 'COMMIT' | 'RECOVER';
export type ChargeTier = 'quick' | 'ready' | 'heavy';
export type AttackWeaponType = 'hammer' | 'spike' | 'shield' | 'headbutt';
export type AttackWeaponSocket = 'right_arm' | 'left_arm' | 'head_front' | 'forebody';
export type AttackVisualRigType =
  | 'generic'
  | 'overhand_smash'
  | 'arm_chain_spike'
  | 'forequarters_shove'
  | 'headbutt_lunge';

export interface AttackMovementModifiers {
  driveMultiplier: number;
  turnMultiplier: number;
  supportMultiplier: number;
  uprightMultiplier: number;
  brakeMultiplier: number;
  jumpLocked: boolean;
}

export interface AttackSlotDefinition {
  id: 'primary';
  appendageRoot: string;
  drivenJoints: string[];
  hitSegments: string[];
  activeBodies?: string[];
  blockBodies?: string[];
  profile: AttackProfile;
  weaponType?: AttackWeaponType;
  weaponSocket?: AttackWeaponSocket;
  visualRigType?: AttackVisualRigType;
  tipSegment?: string;
  tipLocalOffset?: { x: number; y: number; z: number };
  reachMultiplier?: number;

  windupPose: Record<string, number>;
  strikePose: Record<string, number>;
  recoverPose: Record<string, number>;

  windupTime: number;
  recoverTime: number;
  minHoldForCharge: number;
  maxChargeTime: number;

  holdDrainPerSec: number;
  strikeCostLight: number;
  strikeCostHeavy: number;

  damageMulLight: number;
  damageMulHeavy: number;
  knockbackMul: number;

  rootLungeForward: number;
  rootLungeUp: number;
  rootYawAssist: number;
  braceDriveMultiplier?: number;
  braceTurnMultiplier?: number;
  braceSupportMultiplier?: number;
  braceUprightMultiplier?: number;
  braceBrakeMultiplier?: number;
}

export interface ActiveAttackContext {
  slotId: 'primary';
  profile: AttackProfile;
  state: AttackState;
  chargeTier: ChargeTier;
  chargeNorm: number;
  chargeHeldSec: number;
  appendageMassMul: number;
  damageMul: number;
  knockbackMul: number;
  blockReduction: number;
  isBlocking: boolean;
  hitQualityMul: number;
}

export interface AttackTelemetry {
  state: AttackState;
  profile: AttackProfile;
  chargeNorm: number;
  chargeTier: ChargeTier;
  holdSeconds: number;
  isBlocking: boolean;
  stateProgress: number;
  visualRigType: AttackVisualRigType;
}
