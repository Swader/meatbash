import * as THREE from 'three';

/**
 * Third-person follow camera with cinematic features.
 * - Damped spring follow with slight overshoot
 * - Auto-zoom based on target speed
 * - Screen shake system
 * - Dynamic FOV
 */
export function createCamera(canvas: HTMLCanvasElement): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    55, // base FOV
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );

  // Default position - behind and above
  camera.position.set(0, 12, 18);
  camera.lookAt(0, 1, 0);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  return camera;
}

// ---- Shake entry ----
interface ShakeEntry {
  intensity: number;
  duration: number;
  elapsed: number;
}

/**
 * Camera controller that follows a target with cinematic damped-spring motion,
 * auto-zoom, screen shake, and dynamic FOV.
 */
export class CameraController {
  camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(0, 1, 0);

  // Orbit state
  private azimuth = 0;        // horizontal angle (radians)
  private elevation = 0.5;    // vertical angle (radians, 0=level, PI/2=top)
  private baseDistance = 18;  // user-controlled base distance (mouse wheel)
  private distance = 18;     // effective distance (base + auto-zoom)
  private offset = new THREE.Vector3();

  // Smooth follow – damped spring model
  private currentLookAt = new THREE.Vector3(0, 1, 0);
  private lookAtVelocity = new THREE.Vector3(); // spring velocity
  private springStiffness = 4;
  private springDamping = 0.7; // < 1 = underdamped → slight overshoot

  // Target velocity tracking
  private prevTarget = new THREE.Vector3(0, 1, 0);
  private targetVelocity = new THREE.Vector3();

  // Auto-zoom
  private readonly minDistance = 15;
  private readonly maxDistance = 25;
  private readonly zoomSpeedThreshold = 3; // m/s
  private autoZoomOffset = 0;

  // Dynamic FOV
  private readonly baseFOV = 55;
  private readonly maxFOV = 62;
  private currentFOV = 55;

  // Screen shake
  private shakes: ShakeEntry[] = [];
  private shakeOffset = new THREE.Vector3();

  // Mouse orbit
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.setupMouseControls(canvas);
  }

  private setupMouseControls(canvas: HTMLCanvasElement) {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.azimuth -= dx * 0.005;
      this.elevation = Math.max(0.1, Math.min(1.4, this.elevation + dy * 0.005));
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    canvas.addEventListener('mouseup', () => { this.isDragging = false; });
    canvas.addEventListener('mouseleave', () => { this.isDragging = false; });

    canvas.addEventListener('wheel', (e) => {
      // Mouse wheel adjusts the base distance; auto-zoom adds on top
      this.baseDistance = Math.max(5, Math.min(40, this.baseDistance + e.deltaY * 0.02));
    });

    // Prevent context menu on right-click
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- Screen shake ----

  /**
   * Add a screen shake impulse. Multiple shakes stack additively.
   * @param intensity - max pixel-offset magnitude
   * @param duration  - seconds until fully decayed
   */
  addShake(intensity: number, duration: number) {
    this.shakes.push({ intensity, duration, elapsed: 0 });
  }

  private updateShakes(dt: number) {
    this.shakeOffset.set(0, 0, 0);

    // Compute look direction for perpendicular shake axes
    const lookDir = new THREE.Vector3()
      .subVectors(this.currentLookAt, this.camera.position)
      .normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(lookDir, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, lookDir).normalize();

    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.elapsed += dt;
      if (s.elapsed >= s.duration) {
        this.shakes.splice(i, 1);
        continue;
      }
      // Linear decay
      const t = 1 - s.elapsed / s.duration;
      const mag = s.intensity * t;
      // Random perpendicular offset (side-to-side + up-down)
      const rx = (Math.random() * 2 - 1) * mag;
      const ry = (Math.random() * 2 - 1) * mag;
      this.shakeOffset.addScaledVector(right, rx);
      this.shakeOffset.addScaledVector(up, ry);
    }
  }

  // ---- Main update ----

  update(dt: number) {
    // Clamp dt to avoid physics explosion on tab-switch
    const clampedDt = Math.min(dt, 0.1);

    // --- Target velocity ---
    this.targetVelocity.subVectors(this.target, this.prevTarget).divideScalar(clampedDt || 1 / 60);
    this.prevTarget.copy(this.target);

    const speed = this.targetVelocity.length();

    // --- Damped spring follow ---
    // Add a lead/prediction offset when target is moving
    const leadFactor = 0.3;
    const predictedTarget = this.target.clone();
    if (speed > 0.5) {
      predictedTarget.addScaledVector(this.targetVelocity, leadFactor * clampedDt);
    }

    // Damped spring: F = -k*(x - target) - c*v
    // where c = 2*damping*sqrt(k) for critical damping reference
    const k = this.springStiffness;
    const c = 2 * this.springDamping * Math.sqrt(k);

    const displacement = new THREE.Vector3().subVectors(this.currentLookAt, predictedTarget);
    const springForce = new THREE.Vector3()
      .copy(displacement)
      .multiplyScalar(-k)
      .addScaledVector(this.lookAtVelocity, -c);

    this.lookAtVelocity.addScaledVector(springForce, clampedDt);
    this.currentLookAt.addScaledVector(this.lookAtVelocity, clampedDt);

    // --- Auto-zoom ---
    const speedRatio = Math.min(speed / this.zoomSpeedThreshold, 1);
    const targetAutoZoom = speedRatio * (this.maxDistance - this.minDistance);
    // Smooth interpolation of auto-zoom offset
    this.autoZoomOffset += (targetAutoZoom - this.autoZoomOffset) * Math.min(1, 2 * clampedDt);
    this.distance = this.baseDistance + this.autoZoomOffset;

    // --- Dynamic FOV ---
    const targetFOV = this.baseFOV + speedRatio * (this.maxFOV - this.baseFOV);
    this.currentFOV += (targetFOV - this.currentFOV) * Math.min(1, 3 * clampedDt);
    if (Math.abs(this.camera.fov - this.currentFOV) > 0.01) {
      this.camera.fov = this.currentFOV;
      this.camera.updateProjectionMatrix();
    }

    // --- Screen shake ---
    this.updateShakes(clampedDt);

    // --- Orbit position ---
    const cosElev = Math.cos(this.elevation);
    this.offset.set(
      Math.sin(this.azimuth) * cosElev * this.distance,
      Math.sin(this.elevation) * this.distance,
      Math.cos(this.azimuth) * cosElev * this.distance
    );

    const desiredPos = this.currentLookAt.clone().add(this.offset);
    this.camera.position.lerp(desiredPos, 0.1);

    // Apply shake offset
    this.camera.position.add(this.shakeOffset);

    this.camera.lookAt(this.currentLookAt);
  }
}
