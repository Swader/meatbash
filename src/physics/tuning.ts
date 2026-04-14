/**
 * Centralized tuning parameters for biped locomotion.
 * Exposed via tweakpane for live adjustment.
 *
 * All values are mutable — locomotion code reads from this object
 * each fixed step. Adjusting a slider takes effect immediately.
 */

import { Pane, BindingApi } from 'tweakpane';

export const tuning = {
  // ---- Joint motors ----
  hipStiffness: 60,
  hipDamping: 8,
  kneeStiffness: 80,
  kneeDamping: 10,
  ankleStiffness: 30,
  ankleDamping: 4,

  /** Multiplier applied to motor stiffness when airborne (1 = full, 0 = off). */
  airMotorMul: 0.3,

  // ---- Balance: upright torque ----
  uprightStiffness: 80,
  uprightDamping: 12,

  // ---- Balance: height spring ----
  heightStiffness: 600,
  heightDamping: 60,

  /** Target standing height for the pelvis center (m). Calibrated to skeleton. */
  standingHeight: 1.05,

  // ---- Gait targets (radians) ----
  /** Default hip angle when leg is in passive stance. */
  neutralHip: 0.0,
  /** Default knee angle (slight bend prevents hyper-extension). */
  neutralKnee: -0.05,
  /** Hip angle when this leg is the planted "drive" leg. Pulls pelvis forward. */
  driveHip: -0.30,
  driveKnee: -0.05,
  /** Hip angle when this leg is swinging forward through the air. */
  swingHip: 0.55,
  swingKnee: -0.65,
  /** How fast the legs alternate when walking (cycles per second). */
  gaitFrequency: 4.0,

  // ---- Movement ----
  /** Forward push force on the pelvis (N) when W held. */
  forwardForce: 35,
  /** Backward push for S key. */
  backwardForce: 20,
  jumpVelocity: 6.5,
  jumpCooldown: 0.3,

  // ---- Foot ----
  footFriction: 3.0,

  // ---- Stamina costs (per second held) ----
  walkStaminaCost: 8,
  turnStaminaCost: 3,
};

export type Tuning = typeof tuning;

let pane: Pane | null = null;

/**
 * Attach a native browser tooltip to a tweakpane binding by setting
 * the `title` attribute on its underlying DOM element. The browser
 * will show the tooltip after a short hover.
 */
function tip(binding: BindingApi, text: string): BindingApi {
  // Tweakpane v4 exposes `element` on every BladeApi
  const el = (binding as any).element as HTMLElement | undefined;
  if (el) {
    el.title = text;
    // Also set on every input descendant so hovering the slider/number works
    el.querySelectorAll('input, button, [class*="value"]').forEach((child) => {
      (child as HTMLElement).title = text;
    });
  }
  return binding;
}

export function initTuningPanel(): void {
  if (pane) return;

  pane = new Pane({ title: 'MEATBASH Tuning', expanded: false });
  // Position top-right so it doesn't overlap controls/HUD
  const el = (pane as any).element as HTMLElement | undefined;
  if (el) {
    el.style.position = 'absolute';
    el.style.right = '12px';
    el.style.top = '40px';
    el.style.width = '300px';
  }

  // ============================================================
  // JOINT MOTORS
  // ============================================================
  const motors = pane.addFolder({ title: 'Joint Motors', expanded: false });

  tip(
    motors.addBinding(tuning, 'hipStiffness', { min: 0, max: 400, step: 1 }),
    'Hip joint motor stiffness (Nm/rad). Higher = leg fights harder to reach the target hip angle. Too high → jittery legs.'
  );
  tip(
    motors.addBinding(tuning, 'hipDamping', { min: 0, max: 50, step: 0.5 }),
    'Hip motor damping (Nm·s/rad). Resists angular velocity. Higher = smoother but slower leg swings.'
  );
  tip(
    motors.addBinding(tuning, 'kneeStiffness', { min: 0, max: 400, step: 1 }),
    'Knee joint motor stiffness. Holds the lower leg at the knee target angle. Should be slightly stronger than hip.'
  );
  tip(
    motors.addBinding(tuning, 'kneeDamping', { min: 0, max: 50, step: 0.5 }),
    'Knee motor damping. Prevents the knee from snapping rapidly between bent and straight.'
  );
  tip(
    motors.addBinding(tuning, 'ankleStiffness', { min: 0, max: 200, step: 1 }),
    'Ankle joint motor stiffness. Keeps the foot flat against the ground. Lower than hip/knee.'
  );
  tip(
    motors.addBinding(tuning, 'ankleDamping', { min: 0, max: 50, step: 0.5 }),
    'Ankle motor damping. Stops the foot from flapping around.'
  );
  tip(
    motors.addBinding(tuning, 'airMotorMul', { min: 0, max: 1, step: 0.05 }),
    'Multiplier for ALL joint motor stiffness while airborne. 0 = legs go floppy in the air, 1 = legs stay rigid.'
  );

  // ============================================================
  // BALANCE
  // ============================================================
  const balance = pane.addFolder({ title: 'Balance', expanded: false });

  tip(
    balance.addBinding(tuning, 'uprightStiffness', { min: 0, max: 1000, step: 5 }),
    'Upright torque spring stiffness. Pulls the pelvis back toward vertical when it tips. Higher = harder to knock over.'
  );
  tip(
    balance.addBinding(tuning, 'uprightDamping', { min: 0, max: 100, step: 1 }),
    'Upright torque damping. Resists tipping angular velocity. Higher = less wobble but slower recovery.'
  );
  tip(
    balance.addBinding(tuning, 'heightStiffness', { min: 0, max: 3000, step: 10 }),
    'Height spring stiffness (N/m). Pushes pelvis up when below standing height. Counteracts gravity. Too high = bouncy.'
  );
  tip(
    balance.addBinding(tuning, 'heightDamping', { min: 0, max: 300, step: 5 }),
    'Height spring damping (N·s/m). Resists vertical velocity. Critical for stopping bounces. Should be ~0.7×sqrt(k·m).'
  );
  tip(
    balance.addBinding(tuning, 'standingHeight', { min: 0.5, max: 2.0, step: 0.01 }),
    'Target Y position of the pelvis center when standing. Auto-calibrated to the skeleton at startup.'
  );

  // ============================================================
  // GAIT
  // ============================================================
  const gait = pane.addFolder({ title: 'Gait', expanded: false });

  tip(
    gait.addBinding(tuning, 'gaitFrequency', { min: 0.5, max: 12, step: 0.1 }),
    'How fast the legs alternate when W is held (cycles per second). Higher = quicker steps.'
  );
  tip(
    gait.addBinding(tuning, 'neutralHip', { min: -0.5, max: 0.5, step: 0.01 }),
    'Hip angle (rad) when standing still. 0 = leg hangs straight down. Negative = leg behind body.'
  );
  tip(
    gait.addBinding(tuning, 'neutralKnee', { min: -0.5, max: 0.5, step: 0.01 }),
    'Knee angle (rad) when standing still. Slightly negative gives a natural knee bend.'
  );
  tip(
    gait.addBinding(tuning, 'driveHip', { min: -1, max: 0, step: 0.01 }),
    'Hip angle (rad) at the back of a stride. The driving leg pushes back to propel the body forward.'
  );
  tip(
    gait.addBinding(tuning, 'driveKnee', { min: -0.5, max: 0.5, step: 0.01 }),
    'Knee angle (rad) of the driving leg. Usually nearly straight to push the body up and forward.'
  );
  tip(
    gait.addBinding(tuning, 'swingHip', { min: 0, max: 1.2, step: 0.01 }),
    'Hip angle (rad) at the front of a stride. The swinging leg lifts forward through the air.'
  );
  tip(
    gait.addBinding(tuning, 'swingKnee', { min: -1.2, max: 0, step: 0.01 }),
    'Knee angle (rad) of the swinging leg. Bent so the foot clears the ground during swing.'
  );

  // ============================================================
  // MOVEMENT
  // ============================================================
  const move = pane.addFolder({ title: 'Movement', expanded: false });

  tip(
    move.addBinding(tuning, 'forwardForce', { min: 0, max: 300, step: 5 }),
    'Forward force (N) applied to the dynamic pelvis when W is held. Controls walking speed.'
  );
  tip(
    move.addBinding(tuning, 'backwardForce', { min: 0, max: 200, step: 5 }),
    'Backward force (N) applied to the pelvis when S is held. Usually weaker than forward.'
  );
  tip(
    move.addBinding(tuning, 'jumpVelocity', { min: 0, max: 15, step: 0.1 }),
    'Initial upward velocity (m/s) on jump. Higher = bigger jumps.'
  );
  tip(
    move.addBinding(tuning, 'jumpCooldown', { min: 0, max: 2, step: 0.05 }),
    'Minimum time (s) between jumps. Prevents bunny-hopping.'
  );
  tip(
    move.addBinding(tuning, 'footFriction', { min: 0, max: 10, step: 0.1 }),
    'Foot collider friction coefficient. Higher = better grip, less sliding. Affects walk traction. Requires respawn.'
  );
}
