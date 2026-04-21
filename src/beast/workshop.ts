import type { AttackProfile, AttackSlotDefinition } from '../combat/attack-types';
import type { Archetype, BeastDefinition, WeightClassHint } from './beast-data';
import { getPremade } from './premades';

export type WorkshopChargeBias = 'quick' | 'balanced' | 'heavy';
export type WorkshopColorPreset = 'crimson' | 'peach' | 'tallow' | 'ember';

export interface WorkshopDraft {
  sourceBeastId?: string | null;
  name: string;
  archetype: Archetype;
  attackProfile: AttackProfile;
  chargeBias: WorkshopChargeBias;
  colorPreset: WorkshopColorPreset;
}

const STORAGE_KEY = 'meatbash_workshop_beasts_v1';

const COLOR_PRESETS: Record<WorkshopColorPreset, { color: number; emissive: number }> = {
  crimson: { color: 0xd84a4a, emissive: 0x330808 },
  peach: { color: 0xe88b5a, emissive: 0x2e1608 },
  tallow: { color: 0xe8c080, emissive: 0x2a1a08 },
  ember: { color: 0xc85a3a, emissive: 0x2a0808 },
};

export function getWorkshopProfiles(archetype: Archetype): AttackProfile[] {
  return archetype === 'bipedal'
    ? ['blunt', 'spike']
    : ['shield', 'blunt'];
}

export function getWorkshopColorPresets(): WorkshopColorPreset[] {
  return ['crimson', 'peach', 'tallow', 'ember'];
}

export function loadWorkshopBeasts(): BeastDefinition[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBeastDefinitionLike) as BeastDefinition[];
  } catch {
    return [];
  }
}

export function saveWorkshopBeasts(beasts: BeastDefinition[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(beasts));
  } catch (err) {
    console.warn('Failed to save workshop beasts:', err);
  }
}

export function createWorkshopBeast(draft: WorkshopDraft): BeastDefinition {
  const archetype = draft.archetype;
  const profiles = getWorkshopProfiles(archetype);
  const profile = profiles.includes(draft.attackProfile) ? draft.attackProfile : profiles[0]!;
  const attackSlot = applyChargeBias(buildAttackSlot(archetype, profile), draft.chargeBias, archetype, profile);
  const colors = COLOR_PRESETS[draft.colorPreset] ?? COLOR_PRESETS.crimson;
  const cleanName = sanitizeName(draft.name);

  return {
    id: createCustomId(cleanName),
    name:
      cleanName ||
      `${titleCase(profile)} ${archetype === 'bipedal' ? 'MkII' : 'Basher'}`,
    description: `Workshop-forged ${profile} ${archetype} built for immediate fight testing.`,
    archetype,
    isDefault: false,
    personality: derivePersonality(profile),
    hasArms: archetype === 'bipedal',
    weightClassHint: deriveWeightClass(archetype, profile, draft.chargeBias),
    playstyleSummary: buildPlaystyle(archetype, profile, draft.chargeBias),
    attackSlots: [attackSlot],
    visuals: {
      color: colors.color,
      emissive: colors.emissive,
      torsoScale: archetype === 'quadruped' ? 1.08 : 0.96,
      iconEmoji: archetype === 'quadruped' ? '🛠️' : '⚙️',
    },
  };
}

function buildAttackSlot(archetype: Archetype, profile: AttackProfile): AttackSlotDefinition {
  if (archetype === 'bipedal' && profile === 'spike') {
    return clonePrimarySlot('noodlesnake');
  }
  if (archetype === 'bipedal') {
    return clonePrimarySlot('chonkus');
  }
  if (profile === 'shield') {
    return clonePrimarySlot('stomper');
  }
  const slot = clonePrimarySlot('stomper');
  slot.profile = 'blunt';
  delete slot.blockBodies;
  slot.damageMulLight = 0.88;
  slot.damageMulHeavy = 1.24;
  slot.knockbackMul = 1.32;
  slot.rootLungeForward = 1.8;
  slot.rootLungeUp = 0.14;
  slot.braceDriveMultiplier = 0.48;
  slot.braceTurnMultiplier = 1.46;
  return slot;
}

function clonePrimarySlot(id: string): AttackSlotDefinition {
  const slot = getPremade(id)?.attackSlots?.[0];
  if (!slot) throw new Error(`Missing workshop attack template for ${id}`);
  return JSON.parse(JSON.stringify(slot)) as AttackSlotDefinition;
}

function applyChargeBias(
  slot: AttackSlotDefinition,
  bias: WorkshopChargeBias,
  archetype: Archetype,
  profile: AttackProfile
): AttackSlotDefinition {
  const out = slot;
  if (bias === 'quick') {
    out.windupTime *= 0.82;
    out.recoverTime *= 0.86;
    out.maxChargeTime *= 0.78;
    out.holdDrainPerSec *= 0.92;
    out.strikeCostLight *= 0.9;
    out.strikeCostHeavy *= 0.92;
    out.damageMulLight *= 0.94;
    out.damageMulHeavy *= 1.02;
    out.knockbackMul *= 0.94;
    out.rootLungeForward *= 0.96;
    out.braceDriveMultiplier = (out.braceDriveMultiplier ?? 0.58) * 1.08;
    out.braceTurnMultiplier = (out.braceTurnMultiplier ?? 1.45) * 1.1;
    return out;
  }

  if (bias === 'heavy') {
    out.windupTime *= 1.2;
    out.recoverTime *= 1.16;
    out.maxChargeTime *= 1.16;
    out.holdDrainPerSec *= 1.1;
    out.strikeCostLight *= 1.08;
    out.strikeCostHeavy *= 1.18;
    out.damageMulLight *= 1.02;
    out.damageMulHeavy *= 1.22;
    out.knockbackMul *= 1.18;
    out.rootLungeForward *= 1.14;
    out.rootLungeUp *= profile === 'shield' ? 0.96 : 1.08;
    out.braceDriveMultiplier = (out.braceDriveMultiplier ?? 0.58) * 0.94;
    out.braceTurnMultiplier = (out.braceTurnMultiplier ?? 1.45) * 0.94;
    out.braceBrakeMultiplier = (out.braceBrakeMultiplier ?? 1.45) * 1.12;
    return out;
  }

  if (archetype === 'quadruped' && profile === 'blunt') {
    out.knockbackMul *= 1.05;
    out.damageMulHeavy *= 1.04;
  }
  return out;
}

function derivePersonality(profile: AttackProfile): BeastDefinition['personality'] {
  if (profile === 'spike') return 'skirmisher';
  if (profile === 'shield') return 'bully';
  return 'tank';
}

function deriveWeightClass(
  archetype: Archetype,
  profile: AttackProfile,
  bias: WorkshopChargeBias
): WeightClassHint {
  if (archetype === 'quadruped' && (profile === 'shield' || bias === 'heavy')) {
    return bias === 'heavy' ? 'superheavy' : 'heavy';
  }
  if (bias === 'heavy') return 'heavy';
  if (bias === 'quick' && profile === 'spike') return 'light';
  return archetype === 'quadruped' ? 'heavy' : 'middle';
}

function buildPlaystyle(
  archetype: Archetype,
  profile: AttackProfile,
  bias: WorkshopChargeBias
): string {
  const biasText =
    bias === 'quick' ? 'Fast charge' :
    bias === 'heavy' ? 'Slow heavy' :
    'Balanced';
  const archetypeText = archetype === 'quadruped' ? 'stable chassis' : 'armed chassis';
  const profileText =
    profile === 'spike' ? 'precision poke' :
    profile === 'shield' ? 'front shove' :
    'punish swing';
  return `${biasText} ${profileText} on a ${archetypeText}.`;
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

function isBeastDefinitionLike(value: unknown): value is BeastDefinition {
  if (!value || typeof value !== 'object') return false;
  const beast = value as Partial<BeastDefinition>;
  return (
    typeof beast.id === 'string' &&
    typeof beast.name === 'string' &&
    (beast.archetype === 'bipedal' || beast.archetype === 'quadruped') &&
    !!beast.visuals &&
    Array.isArray(beast.attackSlots)
  );
}
