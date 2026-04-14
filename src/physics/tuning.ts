/**
 * Centralized tuning parameters for biped locomotion.
 * Exposed via tweakpane for live adjustment.
 *
 * All values are mutable — locomotion code reads from this object
 * each fixed step. Adjusting a slider takes effect immediately.
 *
 * DESIGN NOTES (post-audit):
 * - Forces/torques are MASS-NORMALIZED at apply time, not here. The
 *   values below are per-unit-mass accelerations and torques so that
 *   heavy beasts and light beasts both feel right.
 * - The state machine (SUPPORTED / STUMBLING / AIRBORNE / FALLEN /
 *   RECOVERING) decides WHEN assistance fires. These values only say
 *   HOW STRONG it is when it fires.
 */

import { Pane, BindingApi } from 'tweakpane';

export const tuning = {
  // ---- Joint motors ----
  hipStiffness: 35,
  hipDamping: 6,
  kneeStiffness: 55,
  kneeDamping: 8,
  ankleStiffness: 14,
  ankleDamping: 3,

  /** Multiplier applied to joint motor stiffness while airborne. */
  airMotorMul: 0.10,

  // ---- Balance: upright torque ----
  uprightStiffness: 50,
  uprightDamping: 9,

  // ---- Balance: support spring ----
  /** k in F = k*(restLen - hitDist) - d*relVel. Only fires when feet are grounded. */
  heightStiffness: 300,
  heightDamping: 32,

  /** Target standing height for the pelvis center above the terrain (m). Auto-calibrated. */
  standingHeight: 1.05,

  // ---- State machine thresholds ----
  /** Tilt (°) above which the beast enters STUMBLING. */
  stumbleTiltDeg: 45,
  /** Tilt (°) above which the beast is counted as FALLEN (but only if support is also lost). */
  fallTiltDeg: 105,
  /** Seconds ungrounded before AIRBORNE takes effect (grace period for steps/jumps). */
  airborneGrace: 0.12,
  /** Seconds in FALLEN before transitioning to RECOVERING. */
  recoverDelay: 0.35,
  /** Seconds RECOVERING ramp lasts. */
  recoverRamp: 0.50,
  /** Support multiplier at start/end of RECOVERING ramp. */
  recoveringAssistStart: 0.25,
  recoveringAssistEnd: 0.90,
  /** Upright torque boost during RECOVERING (> 1 = stronger than SUPPORTED). */
  recoveringUprightBoost: 1.6,
  /** Vertical impulse magnitude at RECOVERING start (per kg of total body mass). */
  recoveringGetupImpulsePerKg: 2.0,

  // ---- Gait targets (radians) ----
  neutralHip: -0.05,
  neutralKnee: -0.22,
  driveHip: -0.18,
  driveKnee: -0.10,
  swingHip: 0.30,
  swingKnee: -0.45,
  /** How fast the legs alternate when walking (cycles per second). */
  gaitFrequency: 2.2,
  /** Dedicated get-up pose — hips slightly forward, knees bent hard. */
  recoverHip: 0.12,
  recoverKnee: -0.85,

  // ---- Movement (mass-normalized) ----
  /** Forward acceleration per kg of total body mass when W is held (m/s² equivalent). */
  forwardAccel: 3.2,
  /** Backward acceleration per kg. */
  backwardAccel: 2.0,
  /** Soft cap on horizontal speed (m/s). */
  maxSpeed: 2.2,
  /** Horizontal damping when no drive input and supported (N per m/s per kg). */
  horizontalBrake: 1.4,
  /** Jump velocity (m/s). Applied as impulse = totalMass * jumpVelocity. */
  jumpVelocity: 6.0,
  jumpCooldown: 0.35,

  // ---- Turning ----
  /** Maximum yaw rate (rad/s) when fully supported. */
  maxYawRate: 0.75,
  /** Smoothing speed for raw turn input. */
  turnSharpness: 5.0,
  /** Smoothing speed for desired yaw rate. */
  yawRateSharpness: 4.0,
  /** Yaw error gain per kg of total body mass. */
  turnTorquePerKg: 0.6,

  // ---- Foot ----
  footFriction: 1.2,

  // ---- Stamina ----
  /** Idle regen (stamina/sec) for the LIGHTEST beast. Heavy halved. */
  idleRegenLight: 24,
  /** Regen while moving or turning, for the lightest beast. */
  movingRegen: 4,
  /** Mass (kg) where idle regen starts dropping. */
  regenLightMass: 6,
  /** Mass (kg) where idle regen is halved. */
  regenHeavyMass: 12,

  walkStaminaCost: 8,
  turnStaminaCost: 3,
};

export type Tuning = typeof tuning;

let pane: Pane | null = null;

/** Attach a native browser tooltip to a tweakpane binding. */
function tip(binding: BindingApi, text: string): BindingApi {
  const el = (binding as any).element as HTMLElement | undefined;
  if (el) {
    el.title = text;
    el.querySelectorAll('input, button, [class*="value"]').forEach((child) => {
      (child as HTMLElement).title = text;
    });
  }
  return binding;
}

export function initTuningPanel(): void {
  if (pane) return;

  pane = new Pane({ title: 'MEATBASH Tuning', expanded: false });
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
    'Knee joint motor stiffness. Holds the lower leg at the knee target angle.'
  );
  tip(
    motors.addBinding(tuning, 'kneeDamping', { min: 0, max: 50, step: 0.5 }),
    'Knee motor damping. Prevents the knee from snapping rapidly between bent and straight.'
  );
  tip(
    motors.addBinding(tuning, 'ankleStiffness', { min: 0, max: 200, step: 1 }),
    'Ankle joint motor stiffness. Keeps the foot flat against the ground.'
  );
  tip(
    motors.addBinding(tuning, 'ankleDamping', { min: 0, max: 50, step: 0.5 }),
    'Ankle motor damping. Stops the foot from flapping around.'
  );
  tip(
    motors.addBinding(tuning, 'airMotorMul', { min: 0, max: 1, step: 0.05 }),
    'Multiplier for joint motor stiffness while AIRBORNE / FALLEN. Very low = limbs go floppy in the air.'
  );

  // ============================================================
  // BALANCE
  // ============================================================
  const balance = pane.addFolder({ title: 'Balance', expanded: false });

  tip(
    balance.addBinding(tuning, 'uprightStiffness', { min: 0, max: 1000, step: 1 }),
    'Upright torque spring stiffness. Pulls pelvis toward vertical. Disabled when FALLEN; boosted when RECOVERING.'
  );
  tip(
    balance.addBinding(tuning, 'uprightDamping', { min: 0, max: 100, step: 0.5 }),
    'Upright torque damping. Higher = less wobble but slower recovery.'
  );
  tip(
    balance.addBinding(tuning, 'heightStiffness', { min: 0, max: 3000, step: 5 }),
    'Support spring stiffness (N/m). Pushes pelvis up along ground normal. ONLY fires when at least one foot is grounded.'
  );
  tip(
    balance.addBinding(tuning, 'heightDamping', { min: 0, max: 300, step: 1 }),
    'Support spring damping (N·s/m). Resists vertical velocity along the ground normal.'
  );
  tip(
    balance.addBinding(tuning, 'standingHeight', { min: 0.5, max: 2.0, step: 0.01 }),
    'Target distance from pelvis center to ground when standing. Auto-calibrated to skeleton at startup.'
  );

  // ============================================================
  // STATE MACHINE
  // ============================================================
  const sm = pane.addFolder({ title: 'State Machine', expanded: false });

  tip(
    sm.addBinding(tuning, 'stumbleTiltDeg', { min: 0, max: 90, step: 1 }),
    'Tilt (°) above which the beast enters STUMBLING. Drive force fades to 0 by this angle.'
  );
  tip(
    sm.addBinding(tuning, 'fallTiltDeg', { min: 0, max: 180, step: 1 }),
    'Tilt (°) above which the beast is FALLEN. Keep high (100°+) — low values make the beast drop dead on any tip.'
  );
  tip(
    sm.addBinding(tuning, 'airborneGrace', { min: 0, max: 1, step: 0.01 }),
    'Seconds feet can be off the ground before AIRBORNE kicks in. Prevents brief steps from registering as airborne.'
  );
  tip(
    sm.addBinding(tuning, 'recoverDelay', { min: 0, max: 3, step: 0.05 }),
    'Seconds in FALLEN before starting to RECOVER. Lets it actually fall.'
  );
  tip(
    sm.addBinding(tuning, 'recoverRamp', { min: 0, max: 3, step: 0.05 }),
    'Duration of the RECOVERING ramp before becoming fully SUPPORTED. Longer = wobblier getups.'
  );
  tip(
    sm.addBinding(tuning, 'recoveringAssistStart', { min: 0, max: 1, step: 0.05 }),
    'Support multiplier at the START of RECOVERING.'
  );
  tip(
    sm.addBinding(tuning, 'recoveringAssistEnd', { min: 0, max: 1, step: 0.05 }),
    'Support multiplier at the END of RECOVERING.'
  );
  tip(
    sm.addBinding(tuning, 'recoveringUprightBoost', { min: 0, max: 3, step: 0.05 }),
    'Upright torque multiplier during RECOVERING. >1 = stronger than SUPPORTED, helps the body snap upright again.'
  );
  tip(
    sm.addBinding(tuning, 'recoveringGetupImpulsePerKg', { min: 0, max: 10, step: 0.1 }),
    'Vertical impulse applied at RECOVERING start, per kg of total body mass. Small hop to unstick the pelvis.'
  );

  // ============================================================
  // GAIT
  // ============================================================
  const gait = pane.addFolder({ title: 'Gait', expanded: false });

  tip(
    gait.addBinding(tuning, 'gaitFrequency', { min: 0.5, max: 12, step: 0.1 }),
    'How fast the legs alternate when walking (cycles/sec).'
  );
  tip(
    gait.addBinding(tuning, 'neutralHip', { min: -0.5, max: 0.5, step: 0.01 }),
    'Hip angle (rad) when standing still. 0 = straight down.'
  );
  tip(
    gait.addBinding(tuning, 'neutralKnee', { min: -0.5, max: 0.5, step: 0.01 }),
    'Knee angle (rad) when standing still. Slightly negative = natural bend.'
  );
  tip(
    gait.addBinding(tuning, 'driveHip', { min: -1, max: 0, step: 0.01 }),
    'Hip angle (rad) at the back of a stride. Drives pelvis forward via foot friction.'
  );
  tip(
    gait.addBinding(tuning, 'driveKnee', { min: -0.5, max: 0.5, step: 0.01 }),
    'Knee angle (rad) of the driving leg. Usually nearly straight.'
  );
  tip(
    gait.addBinding(tuning, 'swingHip', { min: 0, max: 1.2, step: 0.01 }),
    'Hip angle (rad) at the front of a stride.'
  );
  tip(
    gait.addBinding(tuning, 'swingKnee', { min: -1.2, max: 0, step: 0.01 }),
    'Knee angle (rad) of the swinging leg. Bent so the foot clears the ground.'
  );
  tip(
    gait.addBinding(tuning, 'recoverHip', { min: -0.5, max: 1, step: 0.01 }),
    'Hip angle (rad) during RECOVERING — slightly forward for a get-up tuck.'
  );
  tip(
    gait.addBinding(tuning, 'recoverKnee', { min: -1.2, max: 0, step: 0.01 }),
    'Knee angle (rad) during RECOVERING — bent hard for a tuck/push-up pose.'
  );

  // ============================================================
  // MOVEMENT
  // ============================================================
  const move = pane.addFolder({ title: 'Movement', expanded: false });

  tip(
    move.addBinding(tuning, 'forwardAccel', { min: 0, max: 20, step: 0.1 }),
    'Forward drive acceleration per kg of body mass (m/s² equivalent). Mass-scaled: heavier beasts get proportionally more force.'
  );
  tip(
    move.addBinding(tuning, 'backwardAccel', { min: 0, max: 20, step: 0.1 }),
    'Backward drive acceleration per kg.'
  );
  tip(
    move.addBinding(tuning, 'maxSpeed', { min: 0.5, max: 10, step: 0.1 }),
    'Soft cap on horizontal speed (m/s). Also used to taper turn rate.'
  );
  tip(
    move.addBinding(tuning, 'horizontalBrake', { min: 0, max: 20, step: 0.1 }),
    'Horizontal damping force per kg per (m/s) when no drive input. Prevents endless sliding but much weaker than before.'
  );
  tip(
    move.addBinding(tuning, 'jumpVelocity', { min: 0, max: 15, step: 0.1 }),
    'Target upward velocity on jump. The impulse scales with total body mass automatically.'
  );
  tip(
    move.addBinding(tuning, 'jumpCooldown', { min: 0, max: 2, step: 0.05 }),
    'Minimum time between jumps.'
  );
  tip(
    move.addBinding(tuning, 'footFriction', { min: 0, max: 10, step: 0.1 }),
    'Foot collider friction. Higher = better grip. Requires respawn.'
  );

  // ============================================================
  // TURNING
  // ============================================================
  const turn = pane.addFolder({ title: 'Turning', expanded: false });

  tip(
    turn.addBinding(tuning, 'maxYawRate', { min: 0, max: 5, step: 0.05 }),
    'Maximum yaw rate (rad/s) when fully supported.'
  );
  tip(
    turn.addBinding(tuning, 'turnSharpness', { min: 1, max: 30, step: 0.5 }),
    'How quickly raw A/D input ramps up. Higher = snappier.'
  );
  tip(
    turn.addBinding(tuning, 'yawRateSharpness', { min: 1, max: 30, step: 0.5 }),
    'How quickly the desired yaw rate is followed.'
  );
  tip(
    turn.addBinding(tuning, 'turnTorquePerKg', { min: 0, max: 5, step: 0.05 }),
    'Yaw correction torque per kg of body mass. Mass-scaled.'
  );

  // ============================================================
  // STAMINA
  // ============================================================
  const st = pane.addFolder({ title: 'Stamina', expanded: false });

  tip(
    st.addBinding(tuning, 'idleRegenLight', { min: 0, max: 60, step: 1 }),
    'Stamina regen per second when idle, for the LIGHTEST beast. Heavier beasts get less (down to half at regenHeavyMass).'
  );
  tip(
    st.addBinding(tuning, 'movingRegen', { min: 0, max: 60, step: 0.5 }),
    'Stamina regen per second while moving or turning, for the lightest beast.'
  );
  tip(
    st.addBinding(tuning, 'regenLightMass', { min: 0, max: 30, step: 0.5 }),
    'Total mass (kg) at which regen starts dropping from its full value.'
  );
  tip(
    st.addBinding(tuning, 'regenHeavyMass', { min: 0, max: 50, step: 0.5 }),
    'Total mass (kg) at which regen is halved.'
  );
}
