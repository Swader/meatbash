export type AttackProfile = 'blunt' | 'spike' | 'shield';
export type AttackState = 'IDLE' | 'WINDUP' | 'HELD' | 'COMMIT' | 'RECOVER';
export type ChargeTier = 'quick' | 'ready' | 'heavy';

export interface AttackSlotDefinition {
  id: 'primary';
  appendageRoot: string;
  drivenJoints: string[];
  hitSegments: string[];
  profile: AttackProfile;

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
}
