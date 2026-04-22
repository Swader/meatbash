/**
 * Beast definition format.
 *
 * A `BeastDefinition` is a JSON-serializable config that describes a
 * beast's archetype, visual style, and identity. The factory turns it
 * into a live `BeastInstance`.
 *
 * Phase 2 Block 1: archetype is `bipedal` or `quadruped`. Future phases
 * will add slider, wiggler, hexapod, octoped, and SDF-based custom
 * sculpted beasts.
 */

export type Archetype = 'bipedal' | 'quadruped';
export type WeightClassHint = 'light' | 'middle' | 'heavy' | 'superheavy';
export type BeastBodySize = 'small' | 'normal' | 'chonk';
export type BeastStabilityBias = 'wobbly' | 'balanced' | 'stable';
export type BeastWeaponLength = 'short' | 'medium' | 'long';
export type BeastWeaponMass = 'light' | 'normal' | 'heavy';
export type BeastChargeStyle = 'quick' | 'balanced' | 'heavy';

import type {
  AttackProfile,
  AttackSlotDefinition,
  AttackWeaponSocket,
  AttackWeaponType,
} from '../combat/attack-types';

export interface BeastVisuals {
  /** Primary meat color (CSS hex, e.g. 0xdd4444). */
  color: number;
  /** Emissive color for subsurface-scattering look. */
  emissive: number;
  /** Radius multiplier for the visible torso blob. */
  torsoScale: number;
  /** Uniform visual scale applied to the rest of the body meshes. */
  bodyScale?: number;
  /** Name displayed on beast cards. */
  iconEmoji?: string;
}

export interface BeastRuntimeTuning {
  bodyMassScale?: number;
  weaponMassScale?: number;
  moveAccelMultiplier?: number;
  turnMultiplier?: number;
  supportMultiplier?: number;
  uprightMultiplier?: number;
  bodyVisualScale?: number;
  weaponReachMultiplier?: number;
  weaponVisualScale?: number;
  staminaMaxMultiplier?: number;
  staminaRegenMultiplier?: number;
  walkCostMultiplier?: number;
  turnCostMultiplier?: number;
  knockbackResistance?: number;
}

export interface BeastWorkshopConfig {
  sourceBeastId?: string | null;
  weightClass: WeightClassHint;
  bodySize: BeastBodySize;
  stabilityBias: BeastStabilityBias;
  weaponType: AttackWeaponType;
  weaponSocket: AttackWeaponSocket;
  weaponLength: BeastWeaponLength;
  weaponMass: BeastWeaponMass;
  chargeStyle: BeastChargeStyle;
  colorPreset?: string;
}

export interface BeastStatSummary {
  speed: number;
  stability: number;
  reach: number;
  damage: number;
  staminaEconomy: number;
  controlDifficulty: number;
}

export interface BeastDefinition {
  /** Stable unique id (e.g. "chonkus"). Used for localStorage + lookups. */
  id: string;
  /** Short display name. */
  name: string;
  /** One-sentence flavor description. */
  description: string;
  /** Which physics archetype to spawn. */
  archetype: Archetype;
  /** True for built-in premades; false for user-sculpted beasts. */
  isDefault: boolean;
  /** Rough personality tag — used by bot AI and flavor. */
  personality: 'tank' | 'skirmisher' | 'bully' | 'flailer' | 'nimble';
  /** Visual style overrides. */
  visuals: BeastVisuals;
  /**
   * Bipedal beasts only: build the skeleton with two arms (shoulder + elbow).
   * Arms hang loosely and swing outward from centrifugal force when the
   * beast spins, letting them deal melee damage by flailing past enemies.
   * Defaults to false so existing beasts keep the no-arms silhouette.
   */
  hasArms?: boolean;
  attackSlots?: AttackSlotDefinition[];
  weightClassHint?: WeightClassHint;
  playstyleSummary?: string;
  runtimeTuning?: BeastRuntimeTuning;
  workshopConfig?: BeastWorkshopConfig;
  statSummary?: BeastStatSummary;
}

/**
 * A thin listing used by the beast selector UI — just what it needs
 * to render a card. The homepage gets an array of these.
 */
export interface BeastListing {
  id: string;
  name: string;
  description: string;
  archetype: Archetype;
  isDefault: boolean;
  iconEmoji: string;
  weightClass: WeightClassHint;
  attackProfile: AttackProfile | 'none';
  playstyleSummary: string;
  workshopConfig?: BeastWorkshopConfig;
  statSummary?: BeastStatSummary;
}

/** Convert a full definition down to the listing format. */
export function toBeastListing(def: BeastDefinition): BeastListing {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    archetype: def.archetype,
    isDefault: def.isDefault,
    iconEmoji: def.visuals.iconEmoji || (def.archetype === 'quadruped' ? '🐕' : '🚶'),
    weightClass: def.weightClassHint ?? 'middle',
    attackProfile: def.attackSlots?.[0]?.profile ?? 'none',
    playstyleSummary: def.playstyleSummary ?? def.description,
    workshopConfig: def.workshopConfig,
    statSummary: def.statSummary,
  };
}
