import type { DamageEvent } from '../physics/damage';

export interface HitFeedbackHooks {
  addShake: (intensity: number, duration: number, horizontalBias?: number) => void;
  pushCombatText: (text: string) => void;
  playSfx?: (name: string, x?: number, y?: number, z?: number) => void;
}

export function applyHitFeedback(events: DamageEvent[], hooks: HitFeedbackHooks): number {
  let maxHitstop = 0;
  const activeEvents = events.filter((ev) => ev.source === 'active');
  const primary = activeEvents.sort((a, b) => b.amount - a.amount)[0];
  if (!primary) return 0;
  hooks.pushCombatText(primary.splashText);
  const horizontalBias = primary.profile === 'shield' ? 0.85 : 0.5;
  hooks.addShake(primary.shake, 0.14 + Math.min(0.1, primary.feedbackMul * 0.05), horizontalBias);
  hooks.playSfx?.(`hit_${primary.profile ?? 'body'}`, primary.point.x, primary.point.y, primary.point.z);
  maxHitstop = Math.max(maxHitstop, primary.hitstop);
  return maxHitstop;
}
