/**
 * Built-in premade beasts.
 *
 * These are always available in the beast selector, regardless of
 * whether the player has sculpted any custom beasts. Phase 2 ships
 * with two (one biped, one quadruped) so we can demo both archetypes.
 * Future phases add more (Chonkus, Skitter, Sir Slime, etc).
 */

import type { BeastDefinition } from './beast-data';

export const PREMADE_BEASTS: BeastDefinition[] = [
  {
    id: 'chonkus',
    name: 'Chonkus',
    description: 'A chunky pink tank with googly eyes and zero chill.',
    archetype: 'bipedal',
    isDefault: true,
    personality: 'tank',
    visuals: {
      color: 0xdd4444,
      emissive: 0x330808,
      torsoScale: 1.0,
      iconEmoji: '🥩',
    },
  },
  {
    id: 'stomper',
    name: 'Stomper',
    description: 'Four legs, one brain, and a deeply unreasonable stride.',
    archetype: 'quadruped',
    isDefault: true,
    personality: 'bully',
    visuals: {
      color: 0xc85a3a,
      emissive: 0x2a0808,
      torsoScale: 1.1,
      iconEmoji: '🐂',
    },
  },
  {
    id: 'noodlesnake',
    name: 'Noodlesnake',
    description: 'A wobbly biped with extra swagger. Fast but fragile.',
    archetype: 'bipedal',
    isDefault: true,
    personality: 'skirmisher',
    visuals: {
      color: 0xe88b5a,
      emissive: 0x2e1608,
      torsoScale: 0.9,
      iconEmoji: '🌭',
    },
  },
  {
    id: 'butterchonk',
    name: 'Butterchonk',
    description: 'Smooth pale quadruped, deceptively heavy.',
    archetype: 'quadruped',
    isDefault: true,
    personality: 'tank',
    visuals: {
      color: 0xe8c080,
      emissive: 0x2a1a08,
      torsoScale: 1.2,
      iconEmoji: '🧈',
    },
  },
];

/** Look up a premade beast definition by id. Returns undefined if missing. */
export function getPremade(id: string): BeastDefinition | undefined {
  return PREMADE_BEASTS.find((b) => b.id === id);
}

/** Default beast to select on homepage open. */
export const DEFAULT_BEAST_ID = 'chonkus';
