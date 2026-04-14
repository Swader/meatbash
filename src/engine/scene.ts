import * as THREE from 'three';

export interface ArenaObjects {
  ground: THREE.Mesh;
  rocks: THREE.Mesh[];
  walls: THREE.Mesh[];
  dust: THREE.Points;
}

// Simple seeded pseudo-random for deterministic noise
function hashNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// Multi-octave value noise for terrain
function fbmNoise(x: number, y: number, octaves: number = 4): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    const ix = Math.floor(x * frequency);
    const iy = Math.floor(y * frequency);
    const fx = x * frequency - ix;
    const fy = y * frequency - iy;
    // Bilinear interpolation of hash noise
    const a = hashNoise(ix, iy);
    const b = hashNoise(ix + 1, iy);
    const c = hashNoise(ix, iy + 1);
    const d = hashNoise(ix + 1, iy + 1);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const lerped = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    value += lerped * amplitude;
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value / maxAmp;
}

/**
 * Create the game scene with arena terrain, lighting, and atmosphere.
 * Task 1.3: Arena Visual Polish - dramatic combat pit with walls, dust, spotlight.
 */
export function createScene(): {
  scene: THREE.Scene;
  arena: ArenaObjects;
  updateArena: (dt: number) => void;
} {
  const scene = new THREE.Scene();

  // Sky color - warm sunset feel
  scene.background = new THREE.Color(0x2a1520);
  scene.fog = new THREE.FogExp2(0x2a1520, 0.015);

  // === LIGHTING ===

  // Warm directional (sun) - side-lit for dramatic shadows
  const sunLight = new THREE.DirectionalLight(0xffe4b5, 2.5);
  sunLight.position.set(30, 40, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 100;
  sunLight.shadow.camera.left = -40;
  sunLight.shadow.camera.right = 40;
  sunLight.shadow.camera.top = 40;
  sunLight.shadow.camera.bottom = -40;
  sunLight.shadow.bias = -0.001;
  scene.add(sunLight);

  // Cool fill light from opposite side
  const fillLight = new THREE.DirectionalLight(0x8899cc, 0.8);
  fillLight.position.set(-20, 20, -10);
  scene.add(fillLight);

  // Ambient for base visibility
  const ambient = new THREE.AmbientLight(0x443333, 0.6);
  scene.add(ambient);

  // Hemisphere light for sky/ground color bleed
  const hemiLight = new THREE.HemisphereLight(0x886655, 0x332211, 0.5);
  scene.add(hemiLight);

  // === ARENA SPOTLIGHT ===

  // Dramatic spotlight pointing down at arena center
  const spotLight = new THREE.SpotLight(0xffeedd, 3, 60, Math.PI / 5, 0.5, 1.5);
  spotLight.position.set(0, 35, 0);
  spotLight.target.position.set(0, 0, 0);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.set(1024, 1024);
  scene.add(spotLight);
  scene.add(spotLight.target);

  // Subtle underglow at ground level for dramatic rim lighting
  const underGlow = new THREE.PointLight(0xff6633, 1.2, 25, 2);
  underGlow.position.set(0, 0.3, 0);
  scene.add(underGlow);

  // === GROUND ===

  // Large arena floor - sandy/earthy with higher resolution for detail
  const groundGeo = new THREE.PlaneGeometry(80, 80, 64, 64);
  const groundMat = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0.0,
    vertexColors: true,
  });

  // Multi-octave terrain with center flattening + vertex colors
  const posAttr = groundGeo.getAttribute('position');
  const colors = new Float32Array(posAttr.count * 3);
  const sandColor = new THREE.Color(0x8b7355);
  const dirtColor = new THREE.Color(0x5a4a3a);
  const wornColor = new THREE.Color(0x7a6a52);

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);

    // Distance from center (in ground plane, before rotation)
    const dist = Math.sqrt(x * x + y * y);

    // Multi-octave noise displacement
    const baseNoise = fbmNoise(x * 0.08 + 50, y * 0.08 + 50, 5);
    const detailNoise = fbmNoise(x * 0.3 + 100, y * 0.3 + 100, 3) * 0.15;
    let displacement = (baseNoise - 0.5) * 1.2 + detailNoise;

    // Flatten center fighting area (within radius ~12)
    const centerFade = Math.max(0, 1 - dist / 14);
    const centerSmooth = centerFade * centerFade * (3 - 2 * centerFade); // smoothstep
    displacement *= 1 - centerSmooth * 0.85;

    // Slight depression in the very center (worn combat pit)
    if (dist < 10) {
      displacement -= (1 - dist / 10) * 0.15;
    }

    posAttr.setZ(i, displacement);

    // Vertex color: blend sand, dirt, worn based on position + noise
    const colorNoise = fbmNoise(x * 0.15 + 200, y * 0.15 + 200, 3);
    const dirtMix = Math.max(0, Math.min(1, colorNoise * 1.4 - 0.2));

    const col = new THREE.Color();
    if (dist < 12) {
      // Center area: worn look
      const wornMix = (1 - dist / 12) * 0.6;
      col.copy(sandColor).lerp(dirtColor, dirtMix);
      col.lerp(wornColor, wornMix);
    } else {
      col.copy(sandColor).lerp(dirtColor, dirtMix);
    }

    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();

  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // === SCUFF MARKS / TIRE MARKS ON GROUND ===

  const scuffMarks: { x: number; z: number; radius: number; angle: number }[] = [
    { x: 2, z: -3, radius: 1.8, angle: 0.4 },
    { x: -4, z: 1, radius: 2.2, angle: -0.7 },
    { x: 5, z: 4, radius: 1.5, angle: 1.2 },
    { x: -2, z: -6, radius: 2.5, angle: 0 },
    { x: 7, z: -1, radius: 1.2, angle: 2.1 },
  ];

  const scuffMat = new THREE.MeshStandardMaterial({
    color: 0x3a3028,
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });

  for (const sm of scuffMarks) {
    const scuffGeo = new THREE.RingGeometry(sm.radius * 0.6, sm.radius, 16);
    const scuff = new THREE.Mesh(scuffGeo, scuffMat);
    scuff.rotation.x = -Math.PI / 2;
    scuff.position.set(sm.x, 0.02, sm.z);
    scuff.rotation.z = sm.angle;
    scuff.scale.set(1, 0.4 + Math.random() * 0.3, 1); // Stretch into ellipses
    scene.add(scuff);
  }

  // === ROCKS (basic arena obstacles) ===
  // DO NOT CHANGE rock positions - they must match physics colliders in test-beast.ts

  const rocks: THREE.Mesh[] = [];
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x665544,
    roughness: 0.85,
    metalness: 0.1,
  });

  const rockPositions = [
    { x: 8, z: 5, scale: 2.5 },
    { x: -10, z: -7, scale: 3.0 },
    { x: 3, z: -12, scale: 1.8 },
    { x: -5, z: 10, scale: 2.2 },
    { x: 15, z: -3, scale: 1.5 },
  ];

  for (const rp of rockPositions) {
    // Use icosahedron for organic rock shapes
    const rockGeo = new THREE.IcosahedronGeometry(rp.scale, 1);

    // Deform vertices for more natural shape
    const rockPos = rockGeo.getAttribute('position');
    for (let i = 0; i < rockPos.count; i++) {
      const vx = rockPos.getX(i);
      const vy = rockPos.getY(i);
      const vz = rockPos.getZ(i);
      const noise =
        1 + Math.sin(vx * 3 + vy * 2) * 0.2 + Math.cos(vz * 4) * 0.15;
      rockPos.setX(i, vx * noise);
      rockPos.setY(i, vy * noise * 0.6); // Flatten vertically
      rockPos.setZ(i, vz * noise);
    }
    rockGeo.computeVertexNormals();

    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(rp.x, rp.scale * 0.3, rp.z);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
    rocks.push(rock);
  }

  // === ARENA WALLS ===
  // Visible low walls around the perimeter matching physics colliders (halfSize=35)

  const walls: THREE.Mesh[] = [];
  const wallHeight = 3;
  const wallThickness = 1.5;
  const arenaHalfSize = 35;
  const wallSegments = 12; // segments per side for weathered look

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x443322,
    roughness: 0.95,
    metalness: 0.05,
  });

  // Build 4 walls: +X, -X, +Z, -Z
  const wallConfigs = [
    {
      pos: new THREE.Vector3(arenaHalfSize, wallHeight / 2, 0),
      size: [wallThickness, wallHeight, arenaHalfSize * 2],
      segs: [2, 4, wallSegments],
    },
    {
      pos: new THREE.Vector3(-arenaHalfSize, wallHeight / 2, 0),
      size: [wallThickness, wallHeight, arenaHalfSize * 2],
      segs: [2, 4, wallSegments],
    },
    {
      pos: new THREE.Vector3(0, wallHeight / 2, arenaHalfSize),
      size: [arenaHalfSize * 2, wallHeight, wallThickness],
      segs: [wallSegments, 4, 2],
    },
    {
      pos: new THREE.Vector3(0, wallHeight / 2, -arenaHalfSize),
      size: [arenaHalfSize * 2, wallHeight, wallThickness],
      segs: [wallSegments, 4, 2],
    },
  ];

  for (const wc of wallConfigs) {
    const wallGeo = new THREE.BoxGeometry(
      wc.size[0],
      wc.size[1],
      wc.size[2],
      wc.segs[0],
      wc.segs[1],
      wc.segs[2]
    );

    // Vertex displacement for weathered/rough look
    const wallPos = wallGeo.getAttribute('position');
    for (let i = 0; i < wallPos.count; i++) {
      const vx = wallPos.getX(i);
      const vy = wallPos.getY(i);
      const vz = wallPos.getZ(i);

      // Only displace outer faces (not inner or top/bottom edges)
      const disp =
        (Math.sin(vx * 2.3 + vz * 1.7) * 0.15 +
          Math.sin(vy * 3.1 + vx * 0.9) * 0.1 +
          Math.cos(vz * 4.2 + vy * 2.8) * 0.08) *
        0.5;

      wallPos.setX(i, vx + disp * 0.3);
      wallPos.setY(i, vy + disp * 0.15);
      wallPos.setZ(i, vz + disp * 0.3);
    }
    wallGeo.computeVertexNormals();

    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.copy(wc.pos);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
    walls.push(wall);
  }

  // === DEBRIS / PEBBLES ===

  const debrisMat = new THREE.MeshStandardMaterial({
    color: 0x554433,
    roughness: 0.9,
    metalness: 0.05,
  });

  // Scatter small pebbles/debris around the arena
  const debrisCount = 30;
  for (let i = 0; i < debrisCount; i++) {
    const angle = (i / debrisCount) * Math.PI * 2 + Math.sin(i * 7.3) * 0.5;
    const radius = 5 + Math.abs(Math.sin(i * 3.7)) * 25;
    const dx = Math.cos(angle) * radius;
    const dz = Math.sin(angle) * radius;

    const pebbleScale = 0.1 + Math.abs(Math.sin(i * 5.1)) * 0.25;
    const pebbleGeo = new THREE.IcosahedronGeometry(pebbleScale, 0);

    // Flatten and deform pebbles
    const pp = pebbleGeo.getAttribute('position');
    for (let j = 0; j < pp.count; j++) {
      pp.setY(j, pp.getY(j) * 0.4);
      pp.setX(j, pp.getX(j) * (0.8 + Math.sin(j * 2.1) * 0.3));
    }
    pebbleGeo.computeVertexNormals();

    const pebble = new THREE.Mesh(pebbleGeo, debrisMat);
    pebble.position.set(dx, pebbleScale * 0.15, dz);
    pebble.rotation.y = i * 1.3;
    pebble.castShadow = true;
    scene.add(pebble);
  }

  // === DUST PARTICLES ===

  const dustCount = 200;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustSizes = new Float32Array(dustCount);
  const dustAlphas = new Float32Array(dustCount);
  const dustVelocities = new Float32Array(dustCount * 3);

  for (let i = 0; i < dustCount; i++) {
    // Random position within arena bounds
    dustPositions[i * 3] = (hashNoise(i, 0) - 0.5) * 60;
    dustPositions[i * 3 + 1] = 0.5 + hashNoise(i, 1) * 8;
    dustPositions[i * 3 + 2] = (hashNoise(i, 2) - 0.5) * 60;

    dustSizes[i] = 0.05 + hashNoise(i, 3) * 0.1;
    dustAlphas[i] = 0.2 + hashNoise(i, 4) * 0.2;

    // Slow drift velocities
    dustVelocities[i * 3] = (hashNoise(i, 5) - 0.5) * 0.3;
    dustVelocities[i * 3 + 1] = (hashNoise(i, 6) - 0.5) * 0.1;
    dustVelocities[i * 3 + 2] = (hashNoise(i, 7) - 0.5) * 0.3;
  }

  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dustSizes, 1));
  dustGeo.setAttribute('aAlpha', new THREE.BufferAttribute(dustAlphas, 1));

  const dustMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xddbb88) },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      varying float vAlpha;
      uniform float uTime;

      void main() {
        vAlpha = aAlpha;

        vec3 pos = position;
        // Gentle swaying motion
        pos.x += sin(uTime * 0.3 + position.z * 0.1) * 0.5;
        pos.y += sin(uTime * 0.5 + position.x * 0.15) * 0.3;
        pos.z += cos(uTime * 0.25 + position.y * 0.12) * 0.4;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * 80.0 / -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      uniform vec3 uColor;

      void main() {
        // Soft circular particle
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = vAlpha * (1.0 - dist * 2.0);
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const dust = new THREE.Points(dustGeo, dustMaterial);
  scene.add(dust);

  // === UPDATE FUNCTION ===

  let elapsedTime = 0;

  function updateArena(dt: number): void {
    elapsedTime += dt;

    // Update dust particle shader time
    (dustMaterial.uniforms.uTime as { value: number }).value = elapsedTime;

    // Slowly drift particles
    const positions = dustGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < dustCount; i++) {
      let x = positions.getX(i) + dustVelocities[i * 3] * dt;
      let y = positions.getY(i) + dustVelocities[i * 3 + 1] * dt;
      let z = positions.getZ(i) + dustVelocities[i * 3 + 2] * dt;

      // Wrap around arena bounds
      if (x > 30) x = -30;
      if (x < -30) x = 30;
      if (y > 9) y = 0.5;
      if (y < 0.3) y = 8;
      if (z > 30) z = -30;
      if (z < -30) z = 30;

      positions.setXYZ(i, x, y, z);
    }
    positions.needsUpdate = true;

    // Subtle underglow pulse
    underGlow.intensity = 1.2 + Math.sin(elapsedTime * 0.8) * 0.3;
  }

  return {
    scene,
    arena: { ground, rocks, walls, dust },
    updateArena,
  };
}
