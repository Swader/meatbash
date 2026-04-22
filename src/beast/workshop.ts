import type {
  AttackProfile,
  AttackSlotDefinition,
  AttackWeaponSocket,
  AttackWeaponType,
} from '../combat/attack-types';
import type {
  Archetype,
  BeastBodySize,
  BeastChargeStyle,
  BeastDefinition,
  BeastRuntimeTuning,
  BeastStabilityBias,
  BeastStatSummary,
  BeastWeaponLength,
  BeastWeaponMass,
  WeightClassHint,
} from './beast-data';
import { getPremade } from './premades';

export type WorkshopColorPreset = 'crimson' | 'peach' | 'tallow' | 'ember';

export interface WorkshopDraft {
  sourceBeastId?: string | null;
  name: string;
  archetype: Archetype;
  weightClass: WeightClassHint;
  bodySize: BeastBodySize;
  stabilityBias: BeastStabilityBias;
  weaponType: AttackWeaponType;
  weaponSocket: AttackWeaponSocket;
  weaponLength: BeastWeaponLength;
  weaponMass: BeastWeaponMass;
  chargeStyle: BeastChargeStyle;
  colorPreset: WorkshopColorPreset;
}

export interface WorkshopPreview {
  profile: AttackProfile;
  playstyleSummary: string;
  statSummary: BeastStatSummary;
}

const STORAGE_KEY = 'meatbash_workshop_beasts_v1';
export const MAX_WORKSHOP_BEASTS = 16;

const COLOR_PRESETS: Record<WorkshopColorPreset, { color: number; emissive: number; iconEmoji: string }> = {
  crimson: { color: 0xd84a4a, emissive: 0x330808, iconEmoji: '🥩' },
  peach: { color: 0xe88b5a, emissive: 0x2e1608, iconEmoji: '🦴' },
  tallow: { color: 0xe8c080, emissive: 0x2a1a08, iconEmoji: '🛡️' },
  ember: { color: 0xc85a3a, emissive: 0x2a0808, iconEmoji: '🔥' },
};

export function getWorkshopColorPresets(): WorkshopColorPreset[] {
  return ['crimson', 'peach', 'tallow', 'ember'];
}

export function getWorkshopWeightClasses(): WeightClassHint[] {
  return ['light', 'middle', 'heavy', 'superheavy'];
}

export function getWorkshopBodySizes(): BeastBodySize[] {
  return ['small', 'normal', 'chonk'];
}

export function getWorkshopStabilityBiases(): BeastStabilityBias[] {
  return ['wobbly', 'balanced', 'stable'];
}

export function getWorkshopWeaponTypes(archetype: Archetype): AttackWeaponType[] {
  return archetype === 'bipedal'
    ? ['hammer', 'spike', 'shield']
    : ['headbutt', 'shield', 'spike'];
}

export function getWorkshopWeaponSockets(
  archetype: Archetype,
  weaponType: AttackWeaponType
): AttackWeaponSocket[] {
  if (archetype === 'bipedal') {
    return ['right_arm', 'left_arm'];
  }
  return weaponType === 'shield'
    ? ['forebody']
    : ['head_front', 'forebody'];
}

export function getWorkshopWeaponLengths(): BeastWeaponLength[] {
  return ['short', 'medium', 'long'];
}

export function getWorkshopWeaponMasses(): BeastWeaponMass[] {
  return ['light', 'normal', 'heavy'];
}

export function getWorkshopChargeStyles(): BeastChargeStyle[] {
  return ['quick', 'balanced', 'heavy'];
}

export function loadWorkshopBeasts(): BeastDefinition[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBeastDefinitionLike).slice(0, MAX_WORKSHOP_BEASTS) as BeastDefinition[];
  } catch {
    return [];
  }
}

export function saveWorkshopBeasts(beasts: BeastDefinition[]): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(beasts.slice(0, MAX_WORKSHOP_BEASTS)));
    return true;
  } catch (err) {
    console.warn('Failed to save workshop beasts:', err);
    return false;
  }
}

export function createWorkshopBeast(draft: WorkshopDraft): BeastDefinition {
  const normalized = normalizeDraft(draft);
  const slot = buildAttackSlot(normalized);
  const runtimeTuning = buildRuntimeTuning(normalized);
  const colors = COLOR_PRESETS[normalized.colorPreset] ?? COLOR_PRESETS.crimson;
  const cleanName = sanitizeName(normalized.name);
  const playstyleSummary = buildPlaystyle(normalized, slot.profile);
  const statSummary = deriveStatSummary(slot, runtimeTuning);
  const bodyScale = bodyScaleMultiplier(normalized.bodySize);
  const baseTorsoScale = normalized.archetype === 'quadruped' ? 1.08 : 0.96;

  return {
    id: createCustomId(cleanName),
    name:
      cleanName ||
      `${titleCase(normalized.weaponType)} ${normalized.archetype === 'bipedal' ? 'MkII' : 'Basher'}`,
    description: `Workshop-forged ${normalized.weaponType} build tuned for ${normalized.chargeStyle} payoffs.`,
    archetype: normalized.archetype,
    isDefault: false,
    personality: derivePersonality(slot.profile, normalized.weaponType),
    hasArms: normalized.archetype === 'bipedal',
    weightClassHint: normalized.weightClass,
    playstyleSummary,
    attackSlots: [slot],
    runtimeTuning,
    workshopConfig: {
      sourceBeastId: normalized.sourceBeastId,
      weightClass: normalized.weightClass,
      bodySize: normalized.bodySize,
      stabilityBias: normalized.stabilityBias,
      weaponType: normalized.weaponType,
      weaponSocket: normalized.weaponSocket,
      weaponLength: normalized.weaponLength,
      weaponMass: normalized.weaponMass,
      chargeStyle: normalized.chargeStyle,
      colorPreset: normalized.colorPreset,
    },
    statSummary,
    visuals: {
      color: colors.color,
      emissive: colors.emissive,
      torsoScale: baseTorsoScale * bodyScale,
      bodyScale,
      iconEmoji: colors.iconEmoji,
    },
  };
}

export function getWorkshopPreview(draft: WorkshopDraft): WorkshopPreview {
  const normalized = normalizeDraft(draft);
  const slot = buildAttackSlot(normalized);
  const runtimeTuning = buildRuntimeTuning(normalized);
  return {
    profile: slot.profile,
    playstyleSummary: buildPlaystyle(normalized, slot.profile),
    statSummary: deriveStatSummary(slot, runtimeTuning),
  };
}

function normalizeDraft(draft: WorkshopDraft): WorkshopDraft {
  const weaponTypes = getWorkshopWeaponTypes(draft.archetype);
  const weaponType = weaponTypes.includes(draft.weaponType) ? draft.weaponType : weaponTypes[0]!;
  const sockets = getWorkshopWeaponSockets(draft.archetype, weaponType);
  return {
    sourceBeastId: draft.sourceBeastId ?? null,
    name: draft.name,
    archetype: draft.archetype,
    weightClass: getWorkshopWeightClasses().includes(draft.weightClass) ? draft.weightClass : 'middle',
    bodySize: getWorkshopBodySizes().includes(draft.bodySize) ? draft.bodySize : 'normal',
    stabilityBias: getWorkshopStabilityBiases().includes(draft.stabilityBias) ? draft.stabilityBias : 'balanced',
    weaponType,
    weaponSocket: sockets.includes(draft.weaponSocket) ? draft.weaponSocket : sockets[0]!,
    weaponLength: getWorkshopWeaponLengths().includes(draft.weaponLength) ? draft.weaponLength : 'medium',
    weaponMass: getWorkshopWeaponMasses().includes(draft.weaponMass) ? draft.weaponMass : 'normal',
    chargeStyle: getWorkshopChargeStyles().includes(draft.chargeStyle) ? draft.chargeStyle : 'balanced',
    colorPreset: getWorkshopColorPresets().includes(draft.colorPreset) ? draft.colorPreset : 'crimson',
  };
}

function buildAttackSlot(draft: WorkshopDraft): AttackSlotDefinition {
  let slot: AttackSlotDefinition;

  if (draft.archetype === 'bipedal') {
    if (draft.weaponType === 'spike') {
      slot = clonePrimarySlot('noodlesnake');
    } else {
      slot = clonePrimarySlot('chonkus');
      if (draft.weaponType === 'shield') {
        slot.profile = 'shield';
        slot.blockBodies = [...(slot.activeBodies ?? slot.hitSegments)];
        slot.damageMulLight *= 0.82;
        slot.damageMulHeavy *= 0.92;
        slot.knockbackMul *= 1.18;
        slot.rootLungeForward *= 0.94;
      }
    }
  } else if (draft.weaponType === 'shield') {
    slot = clonePrimarySlot('butterchonk');
  } else {
    slot = clonePrimarySlot('stomper');
    slot.profile = draft.weaponType === 'spike' ? 'spike' : 'blunt';
    slot.visualRigType = 'headbutt_lunge';
    slot.activeBodies = ['torso'];
    slot.hitSegments = ['torso'];
    slot.tipSegment = 'torso';
    slot.tipLocalOffset =
      draft.weaponType === 'spike'
        ? { x: 0, y: 0.05, z: 0.45 }
        : { x: 0, y: 0.04, z: 0.38 };
    delete slot.blockBodies;
    slot.damageMulLight *= draft.weaponType === 'spike' ? 0.94 : 1.04;
    slot.damageMulHeavy *= draft.weaponType === 'spike' ? 1.1 : 1.16;
    slot.knockbackMul *= draft.weaponType === 'spike' ? 0.92 : 1.08;
  }

  slot.weaponType = draft.weaponType;
  slot.weaponSocket = draft.weaponSocket;
  slot.reachMultiplier = weaponLengthMultiplier(draft.weaponLength);

  if (draft.archetype === 'bipedal' && draft.weaponSocket === 'left_arm') {
    slot = mirrorBipedSlot(slot);
  }
  if (draft.archetype === 'bipedal' && draft.weaponSocket === 'right_arm' && slot.appendageRoot.endsWith('_l')) {
    slot = mirrorBipedSlot(slot);
  }
  if (draft.archetype === 'quadruped') {
    slot.tipLocalOffset =
      draft.weaponSocket === 'forebody'
        ? { x: 0, y: 0.03, z: 0.3 * (slot.reachMultiplier ?? 1) }
        : slot.tipLocalOffset;
    slot.weaponSocket = draft.weaponSocket;
  }

  applyWeaponMass(slot, draft.weaponMass);
  applyChargeStyle(slot, draft.chargeStyle, slot.profile);
  return slot;
}

function buildRuntimeTuning(draft: WorkshopDraft): BeastRuntimeTuning {
  const runtime: BeastRuntimeTuning = {
    bodyMassScale: 1,
    weaponMassScale: 1,
    moveAccelMultiplier: 1,
    turnMultiplier: 1,
    supportMultiplier: 1,
    uprightMultiplier: 1,
    bodyVisualScale: 1,
    weaponReachMultiplier: weaponLengthMultiplier(draft.weaponLength),
    weaponVisualScale: weaponVisualMultiplier(draft.weaponLength),
    staminaMaxMultiplier: 1,
    staminaRegenMultiplier: 1,
    walkCostMultiplier: 1,
    turnCostMultiplier: 1,
    knockbackResistance: 1,
  };

  const weightPreset = WEIGHT_PRESETS[draft.weightClass];
  const sizePreset = BODY_SIZE_PRESETS[draft.bodySize];
  const stabilityPreset = STABILITY_PRESETS[draft.stabilityBias];
  const weaponMassPreset = WEAPON_MASS_PRESETS[draft.weaponMass];

  runtime.bodyMassScale = weightPreset.bodyMassScale * sizePreset.bodyMassScale;
  runtime.weaponMassScale = weaponMassPreset.weaponMassScale;
  runtime.moveAccelMultiplier = weightPreset.moveAccelMultiplier * sizePreset.moveAccelMultiplier * stabilityPreset.moveAccelMultiplier;
  runtime.turnMultiplier = weightPreset.turnMultiplier * stabilityPreset.turnMultiplier;
  runtime.supportMultiplier = stabilityPreset.supportMultiplier;
  runtime.uprightMultiplier = stabilityPreset.uprightMultiplier;
  runtime.bodyVisualScale = sizePreset.bodyVisualScale;
  runtime.weaponVisualScale = weaponMassPreset.weaponVisualScale * weaponVisualMultiplier(draft.weaponLength);
  runtime.staminaMaxMultiplier = weightPreset.staminaMaxMultiplier * sizePreset.staminaMaxMultiplier;
  runtime.staminaRegenMultiplier = weightPreset.staminaRegenMultiplier;
  runtime.walkCostMultiplier = weightPreset.walkCostMultiplier * weaponMassPreset.staminaCostMultiplier;
  runtime.turnCostMultiplier = weightPreset.turnCostMultiplier * weaponMassPreset.staminaCostMultiplier;
  runtime.knockbackResistance = weightPreset.knockbackResistance * stabilityPreset.knockbackResistance;

  if (draft.weaponType === 'shield') {
    runtime.supportMultiplier *= 1.05;
    runtime.uprightMultiplier *= 1.05;
    runtime.knockbackResistance *= 1.06;
  } else if (draft.weaponType === 'spike') {
    runtime.moveAccelMultiplier *= 1.03;
    runtime.turnMultiplier *= 1.04;
  } else if (draft.weaponType === 'headbutt') {
    runtime.bodyMassScale *= 1.03;
  }
  if (draft.archetype === 'quadruped') {
    runtime.supportMultiplier *= 1.06;
    runtime.knockbackResistance *= 1.04;
  } else {
    runtime.turnMultiplier *= 1.03;
  }

  return runtime;
}

function deriveStatSummary(slot: AttackSlotDefinition, runtime: BeastRuntimeTuning): BeastStatSummary {
  const avgDamage = (slot.damageMulLight + slot.damageMulHeavy) * 0.5;
  const avgCost = (slot.strikeCostLight + slot.strikeCostHeavy) * 0.5;
  const speed = clamp01(0.56 + (runtime.moveAccelMultiplier! - 1) * 0.8 + (runtime.turnMultiplier! - 1) * 0.45 - (runtime.bodyMassScale! - 1) * 0.35);
  const stability = clamp01(0.5 + (runtime.supportMultiplier! - 1) * 0.75 + (runtime.uprightMultiplier! - 1) * 0.65 + (runtime.knockbackResistance! - 1) * 0.45);
  const reach = clamp01(0.45 + ((slot.reachMultiplier ?? 1) - 1) * 0.85 + ((runtime.weaponReachMultiplier ?? 1) - 1) * 0.25);
  const damage = clamp01(0.42 + (avgDamage - 1) * 0.5 + (slot.knockbackMul - 1) * 0.42 + ((runtime.weaponMassScale ?? 1) - 1) * 0.35);
  const staminaEconomy = clamp01(0.58 + ((runtime.staminaRegenMultiplier ?? 1) - 1) * 0.65 + ((runtime.staminaMaxMultiplier ?? 1) - 1) * 0.35 - (avgCost - 12) * 0.018 - ((runtime.walkCostMultiplier ?? 1) - 1) * 0.55);
  const controlDifficulty = clamp01(
    0.4 +
      ((runtime.bodyMassScale ?? 1) - 1) * 0.28 +
      ((runtime.weaponMassScale ?? 1) - 1) * 0.32 +
      ((slot.reachMultiplier ?? 1) - 1) * 0.28 -
      ((runtime.supportMultiplier ?? 1) - 1) * 0.5 -
      ((runtime.turnMultiplier ?? 1) - 1) * 0.3
  );

  return {
    speed,
    stability,
    reach,
    damage,
    staminaEconomy,
    controlDifficulty,
  };
}

function applyWeaponMass(slot: AttackSlotDefinition, weaponMass: BeastWeaponMass): void {
  const preset = WEAPON_MASS_SLOT_PRESETS[weaponMass];
  slot.windupTime *= preset.windup;
  slot.recoverTime *= preset.recover;
  slot.holdDrainPerSec *= preset.holdDrain;
  slot.strikeCostLight *= preset.cost;
  slot.strikeCostHeavy *= preset.cost;
  slot.damageMulLight *= preset.damage;
  slot.damageMulHeavy *= preset.damage;
  slot.knockbackMul *= preset.knockback;
}

function applyChargeStyle(
  slot: AttackSlotDefinition,
  chargeStyle: BeastChargeStyle,
  profile: AttackProfile
): void {
  if (chargeStyle === 'quick') {
    slot.windupTime *= 0.82;
    slot.recoverTime *= 0.86;
    slot.maxChargeTime *= 0.8;
    slot.holdDrainPerSec *= 0.92;
    slot.strikeCostLight *= 0.9;
    slot.strikeCostHeavy *= 0.92;
    slot.damageMulLight *= 0.95;
    slot.damageMulHeavy *= 1.02;
    slot.knockbackMul *= 0.94;
    slot.rootLungeForward *= 0.96;
    slot.braceDriveMultiplier = (slot.braceDriveMultiplier ?? 0.58) * 1.08;
    slot.braceTurnMultiplier = (slot.braceTurnMultiplier ?? 1.45) * 1.1;
    return;
  }

  if (chargeStyle === 'heavy') {
    slot.windupTime *= 1.2;
    slot.recoverTime *= 1.16;
    slot.maxChargeTime *= 1.16;
    slot.holdDrainPerSec *= 1.1;
    slot.strikeCostLight *= 1.08;
    slot.strikeCostHeavy *= 1.18;
    slot.damageMulLight *= 1.02;
    slot.damageMulHeavy *= 1.22;
    slot.knockbackMul *= 1.18;
    slot.rootLungeForward *= 1.14;
    slot.rootLungeUp *= profile === 'shield' ? 0.96 : 1.08;
    slot.braceDriveMultiplier = (slot.braceDriveMultiplier ?? 0.58) * 0.94;
    slot.braceTurnMultiplier = (slot.braceTurnMultiplier ?? 1.45) * 0.94;
    slot.braceBrakeMultiplier = (slot.braceBrakeMultiplier ?? 1.45) * 1.12;
  }
}

function clonePrimarySlot(id: string): AttackSlotDefinition {
  const slot = getPremade(id)?.attackSlots?.[0];
  if (!slot) throw new Error(`Missing workshop attack template for ${id}`);
  return JSON.parse(JSON.stringify(slot)) as AttackSlotDefinition;
}

function mirrorBipedSlot(slot: AttackSlotDefinition): AttackSlotDefinition {
  const out = clone(slot);
  out.appendageRoot = swapSide(out.appendageRoot);
  out.drivenJoints = out.drivenJoints.map(swapSide);
  out.hitSegments = out.hitSegments.map(swapSide);
  out.activeBodies = out.activeBodies?.map(swapSide);
  out.blockBodies = out.blockBodies?.map(swapSide);
  out.weaponSocket =
    out.weaponSocket === 'left_arm' ? 'right_arm' :
    out.weaponSocket === 'right_arm' ? 'left_arm' :
    out.weaponSocket;
  if (out.tipSegment) out.tipSegment = swapSide(out.tipSegment);
  if (out.tipLocalOffset) out.tipLocalOffset.x *= -1;
  out.rootYawAssist *= -1;

  out.windupPose = mirrorPose(out.windupPose);
  out.strikePose = mirrorPose(out.strikePose);
  out.recoverPose = mirrorPose(out.recoverPose);
  return out;
}

function mirrorPose(pose: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(pose)) {
    const mirroredName = swapSide(name);
    out[mirroredName] = mirroredName.startsWith('shoulder_') ? -value : value;
  }
  return out;
}

function swapSide(name: string): string {
  if (name.endsWith('_l')) return `${name.slice(0, -2)}_r`;
  if (name.endsWith('_r')) return `${name.slice(0, -2)}_l`;
  return name;
}

function buildPlaystyle(draft: WorkshopDraft, profile: AttackProfile): string {
  const weightText =
    draft.weightClass === 'superheavy' ? 'superheavy' :
    draft.weightClass === 'heavy' ? 'heavy' :
    draft.weightClass === 'light' ? 'light' :
    'mid-weight';
  const stabilityText =
    draft.stabilityBias === 'stable' ? 'brace-first' :
    draft.stabilityBias === 'wobbly' ? 'slippery' :
    'balanced';
  const weaponText =
    profile === 'spike' ? 'precision spike' :
    profile === 'shield' ? 'shield shove' :
    draft.weaponType === 'headbutt' ? 'headbutt ram' :
    'hammer smash';
  return `${titleCase(weightText)} ${weaponText} with ${stabilityText} footing and ${draft.chargeStyle} charge timing.`;
}

function derivePersonality(
  profile: AttackProfile,
  weaponType: AttackWeaponType
): BeastDefinition['personality'] {
  if (profile === 'spike') return 'skirmisher';
  if (profile === 'shield') return 'bully';
  if (weaponType === 'headbutt') return 'flailer';
  return 'tank';
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function createCustomId(name: string): string {
  const slug = sanitizeName(name).toLowerCase().replace(/\s+/g, '-') || 'workshop';
  return `custom-${slug}-${Date.now().toString(36)}`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function bodyScaleMultiplier(size: BeastBodySize): number {
  return BODY_SIZE_PRESETS[size].bodyVisualScale;
}

function weaponLengthMultiplier(length: BeastWeaponLength): number {
  if (length === 'short') return 0.86;
  if (length === 'long') return 1.18;
  return 1;
}

function weaponVisualMultiplier(length: BeastWeaponLength): number {
  if (length === 'short') return 0.92;
  if (length === 'long') return 1.18;
  return 1;
}

const WEIGHT_PRESETS: Record<
  WeightClassHint,
  {
    bodyMassScale: number;
    moveAccelMultiplier: number;
    turnMultiplier: number;
    staminaMaxMultiplier: number;
    staminaRegenMultiplier: number;
    walkCostMultiplier: number;
    turnCostMultiplier: number;
    knockbackResistance: number;
  }
> = {
  light: {
    bodyMassScale: 0.84,
    moveAccelMultiplier: 1.12,
    turnMultiplier: 1.08,
    staminaMaxMultiplier: 0.94,
    staminaRegenMultiplier: 1.12,
    walkCostMultiplier: 0.92,
    turnCostMultiplier: 0.92,
    knockbackResistance: 0.86,
  },
  middle: {
    bodyMassScale: 1,
    moveAccelMultiplier: 1,
    turnMultiplier: 1,
    staminaMaxMultiplier: 1,
    staminaRegenMultiplier: 1,
    walkCostMultiplier: 1,
    turnCostMultiplier: 1,
    knockbackResistance: 1,
  },
  heavy: {
    bodyMassScale: 1.18,
    moveAccelMultiplier: 0.96,
    turnMultiplier: 0.95,
    staminaMaxMultiplier: 1.04,
    staminaRegenMultiplier: 0.94,
    walkCostMultiplier: 1.05,
    turnCostMultiplier: 1.05,
    knockbackResistance: 1.12,
  },
  superheavy: {
    bodyMassScale: 1.34,
    moveAccelMultiplier: 0.9,
    turnMultiplier: 0.88,
    staminaMaxMultiplier: 1.1,
    staminaRegenMultiplier: 0.88,
    walkCostMultiplier: 1.12,
    turnCostMultiplier: 1.1,
    knockbackResistance: 1.24,
  },
};

const BODY_SIZE_PRESETS: Record<
  BeastBodySize,
  {
    bodyMassScale: number;
    moveAccelMultiplier: number;
    bodyVisualScale: number;
    staminaMaxMultiplier: number;
  }
> = {
  small: {
    bodyMassScale: 0.92,
    moveAccelMultiplier: 1.04,
    bodyVisualScale: 0.92,
    staminaMaxMultiplier: 0.95,
  },
  normal: {
    bodyMassScale: 1,
    moveAccelMultiplier: 1,
    bodyVisualScale: 1,
    staminaMaxMultiplier: 1,
  },
  chonk: {
    bodyMassScale: 1.08,
    moveAccelMultiplier: 0.95,
    bodyVisualScale: 1.1,
    staminaMaxMultiplier: 1.06,
  },
};

const STABILITY_PRESETS: Record<
  BeastStabilityBias,
  {
    moveAccelMultiplier: number;
    turnMultiplier: number;
    supportMultiplier: number;
    uprightMultiplier: number;
    knockbackResistance: number;
  }
> = {
  wobbly: {
    moveAccelMultiplier: 1.04,
    turnMultiplier: 1.08,
    supportMultiplier: 0.9,
    uprightMultiplier: 0.9,
    knockbackResistance: 0.92,
  },
  balanced: {
    moveAccelMultiplier: 1,
    turnMultiplier: 1,
    supportMultiplier: 1,
    uprightMultiplier: 1,
    knockbackResistance: 1,
  },
  stable: {
    moveAccelMultiplier: 0.96,
    turnMultiplier: 0.95,
    supportMultiplier: 1.15,
    uprightMultiplier: 1.18,
    knockbackResistance: 1.08,
  },
};

const WEAPON_MASS_PRESETS: Record<
  BeastWeaponMass,
  {
    weaponMassScale: number;
    weaponVisualScale: number;
    staminaCostMultiplier: number;
  }
> = {
  light: {
    weaponMassScale: 0.88,
    weaponVisualScale: 0.94,
    staminaCostMultiplier: 0.92,
  },
  normal: {
    weaponMassScale: 1,
    weaponVisualScale: 1,
    staminaCostMultiplier: 1,
  },
  heavy: {
    weaponMassScale: 1.22,
    weaponVisualScale: 1.16,
    staminaCostMultiplier: 1.14,
  },
};

const WEAPON_MASS_SLOT_PRESETS: Record<
  BeastWeaponMass,
  {
    windup: number;
    recover: number;
    holdDrain: number;
    cost: number;
    damage: number;
    knockback: number;
  }
> = {
  light: {
    windup: 0.88,
    recover: 0.9,
    holdDrain: 0.9,
    cost: 0.9,
    damage: 0.94,
    knockback: 0.92,
  },
  normal: {
    windup: 1,
    recover: 1,
    holdDrain: 1,
    cost: 1,
    damage: 1,
    knockback: 1,
  },
  heavy: {
    windup: 1.16,
    recover: 1.14,
    holdDrain: 1.1,
    cost: 1.16,
    damage: 1.16,
    knockback: 1.18,
  },
};

function isBeastDefinitionLike(value: unknown): value is BeastDefinition {
  if (!value || typeof value !== 'object') return false;
  const beast = value as Partial<BeastDefinition>;
  return (
    typeof beast.id === 'string' &&
    typeof beast.name === 'string' &&
    typeof beast.description === 'string' &&
    (beast.archetype === 'bipedal' || beast.archetype === 'quadruped') &&
    typeof beast.isDefault === 'boolean' &&
    typeof beast.personality === 'string' &&
    isVisualsLike(beast.visuals) &&
    Array.isArray(beast.attackSlots) &&
    beast.attackSlots.every(isAttackSlotDefinitionLike)
  );
}

function isVisualsLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const visuals = value as Record<string, unknown>;
  return (
    typeof visuals.color === 'number' &&
    Number.isFinite(visuals.color) &&
    typeof visuals.emissive === 'number' &&
    Number.isFinite(visuals.emissive)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function isAttackSlotDefinitionLike(value: unknown): value is AttackSlotDefinition {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Partial<AttackSlotDefinition>;
  return (
    slot.id === 'primary' &&
    typeof slot.appendageRoot === 'string' &&
    isStringArray(slot.drivenJoints) &&
    isStringArray(slot.hitSegments) &&
    (slot.activeBodies === undefined || isStringArray(slot.activeBodies)) &&
    (slot.blockBodies === undefined || isStringArray(slot.blockBodies)) &&
    (slot.profile === 'blunt' || slot.profile === 'spike' || slot.profile === 'shield') &&
    isNumberRecord(slot.windupPose) &&
    isNumberRecord(slot.strikePose) &&
    isNumberRecord(slot.recoverPose) &&
    typeof slot.windupTime === 'number' &&
    Number.isFinite(slot.windupTime) &&
    typeof slot.recoverTime === 'number' &&
    Number.isFinite(slot.recoverTime) &&
    typeof slot.minHoldForCharge === 'number' &&
    Number.isFinite(slot.minHoldForCharge) &&
    typeof slot.maxChargeTime === 'number' &&
    Number.isFinite(slot.maxChargeTime) &&
    typeof slot.holdDrainPerSec === 'number' &&
    Number.isFinite(slot.holdDrainPerSec) &&
    typeof slot.strikeCostLight === 'number' &&
    Number.isFinite(slot.strikeCostLight) &&
    typeof slot.strikeCostHeavy === 'number' &&
    Number.isFinite(slot.strikeCostHeavy) &&
    typeof slot.damageMulLight === 'number' &&
    Number.isFinite(slot.damageMulLight) &&
    typeof slot.damageMulHeavy === 'number' &&
    Number.isFinite(slot.damageMulHeavy) &&
    typeof slot.knockbackMul === 'number' &&
    Number.isFinite(slot.knockbackMul) &&
    typeof slot.rootLungeForward === 'number' &&
    Number.isFinite(slot.rootLungeForward) &&
    typeof slot.rootLungeUp === 'number' &&
    Number.isFinite(slot.rootLungeUp) &&
    typeof slot.rootYawAssist === 'number' &&
    Number.isFinite(slot.rootYawAssist)
  );
}
