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

export interface BeastVisuals {
  /** Primary meat color (CSS hex, e.g. 0xdd4444). */
  color: number;
  /** Emissive color for subsurface-scattering look. */
  emissive: number;
  /** Radius multiplier for the visible torso blob. */
  torsoScale: number;
  /** Name displayed on beast cards. */
  iconEmoji?: string;
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
  };
}
