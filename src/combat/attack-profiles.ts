import type { AttackProfile } from './attack-types';

export interface AttackProfileTuning {
  activeWindow: number;
  blockReduction: number;
  damageMul: number;
  knockbackMul: number;
  precisionBias: number;
}

export const ATTACK_PROFILES: Record<AttackProfile, AttackProfileTuning> = {
  blunt: {
    activeWindow: 0.16,
    blockReduction: 0.15,
    damageMul: 1.0,
    knockbackMul: 1.2,
    precisionBias: 0.0,
  },
  spike: {
    activeWindow: 0.1,
    blockReduction: 0.05,
    damageMul: 1.25,
    knockbackMul: 0.8,
    precisionBias: 1.0,
  },
  shield: {
    activeWindow: 0.14,
    blockReduction: 0.5,
    damageMul: 0.65,
    knockbackMul: 1.4,
    precisionBias: -0.2,
  },
};

export function getChargeTier(holdSeconds: number): 'quick' | 'ready' | 'heavy' {
  if (holdSeconds < 0.18) return 'quick';
  if (holdSeconds < 0.55) return 'ready';
  return 'heavy';
}

export function getChargeDamageMul(tier: 'quick' | 'ready' | 'heavy'): number {
  if (tier === 'quick') return 0.85;
  if (tier === 'ready') return 1.0;
  return 1.35;
}

export function getChargeKnockbackMul(tier: 'quick' | 'ready' | 'heavy'): number {
  if (tier === 'quick') return 0.9;
  if (tier === 'ready') return 1.0;
  return 1.35;
}

export function getChargeCostLerp(tier: 'quick' | 'ready' | 'heavy'): number {
  if (tier === 'quick') return 0;
  if (tier === 'ready') return 0.5;
  return 1;
}
