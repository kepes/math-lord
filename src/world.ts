/**
 * Everything the player looks at but does not play with: sky, the land far below, clouds, and the
 * rock tower they stand on. The player is at the origin, the top of the tower is the floor (y = 0).
 */
import * as THREE from 'three';

/** Height of the land under the tower: it is a long way down. */
export const GROUND_Y = -110;
const HORIZON = '#c4ecff';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

function createSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#1568f0') },
      uMid: { value: new THREE.Color('#3aa9ff') },
      uHorizon: { value: new THREE.Color(HORIZON) },
      uSun: { value: new THREE.Vector3(0.42, 0.55, -0.72).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.28, h));
        col = mix(col, uTop, smoothstep(0.2, 0.85, h));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.86, 0.55) * (pow(s, 600.0) * 3.0 + pow(s, 14.0) * 0.28);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), material);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  return sky;
}

// ---------------------------------------------------------------------------
// Land
// ---------------------------------------------------------------------------

/** Height of the land above the water level. Negative is under water. */
function landHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h =
    5.5 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 - 0.4) +
    3.2 * Math.sin(x * 0.047 - z * 0.039 + 2.1) +
    1.6 * Math.cos(x * 0.11 + 0.7) * Math.sin(z * 0.093 + 1.9) +
    1.4;
  // a winding river and a lake that never comes too close to the tower
  const river = Math.abs(z - 46 - 22 * Math.sin(x * 0.018));
  h -= 7 * Math.exp(-(river * river) / 190);
  const lake = Math.hypot(x + 58, z + 38);
  h -= 9 * Math.exp(-(lake * lake) / 1500);
  // the tower stands on a low hill
  const hill = Math.exp(-(r * r) / 420);
  h = h * (1 - hill) + 3.2 * hill;
  // the land rises towards the far mountains
  return h + Math.max(0, r - 230) * 0.07;
}

function createLand(): THREE.Group {
  const group = new THREE.Group();
  group.position.y = GROUND_Y;

  const size = 1100;
  const cells = 110;
  const geometry = new THREE.PlaneGeometry(size, size, cells, cells);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color('#ffe58a');
  const grassA = new THREE.Color('#62df35');
  const grassB = new THREE.Color('#2fb944');
  const high = new THREE.Color('#b7e04a');
  const c = new THREE.Color();
  const rand = seeded(11);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = landHeight(x, z);
    pos.setY(i, h);
    if (h < 0.5) c.copy(sand);
    else if (h < 7) c.copy(grassA).lerp(grassB, THREE.MathUtils.clamp((h - 0.5) / 6.5 + (rand() - 0.5) * 0.5, 0, 1));
    else c.copy(grassB).lerp(high, THREE.MathUtils.clamp((h - 7) / 8, 0, 1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  // Water is not a surface of its own: a flat sheet meets the shore at such a shallow angle that,
  // from up here, the depth buffer cannot tell which of the two is in front, and the shoreline
  // flickers. Instead the land is painted as water wherever it lies below the water level – one
  // surface, and the shoreline is exactly the line of height 0. Paler in the shallows.
  const land = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  land.onBeforeCompile = (shader) => {
    shader.uniforms.uShallow = { value: new THREE.Color('#6fe0ff') };
    shader.uniforms.uDeep = { value: new THREE.Color('#14aaff') };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLandY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLandY;\nuniform vec3 uShallow;\nuniform vec3 uDeep;')
      .replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\nif ( vLandY < 0.0 ) gl_FragColor.rgb = mix( uShallow, uDeep, smoothstep( 0.0, 2.2, - vLandY ) );',
      );
  };
  group.add(new THREE.Mesh(geometry, land));

  // trees: round ones and pines, a trunk each
  const count = 420;
  const dummy = new THREE.Object3D();
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), new THREE.MeshLambertMaterial({ color: '#8a5a2b' }), count);
  const round = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), new THREE.MeshLambertMaterial({ flatShading: true }), count);
  const pine = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 6.5, 7), new THREE.MeshLambertMaterial({ flatShading: true }), count);
  const greens = ['#1fa83c', '#35c94a', '#12893a', '#58d632', '#0f9d58'].map((g) => new THREE.Color(g));
  let rounds = 0;
  let pines = 0;
  let placed = 0;
  for (let tries = 0; placed < count && tries < 20000; tries++) {
    const angle = rand() * Math.PI * 2;
    const dist = 9 + rand() ** 1.4 * 250;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const h = landHeight(x, z);
    if (h < 1) continue;
    // woods: trees come in patches
    if (Math.sin(x * 0.06) * Math.cos(z * 0.05) + rand() * 0.9 < 0.35) continue;
    const s = 0.8 + rand() * 0.9;
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.setScalar(s);
    dummy.position.set(x, h + 1.3 * s, z);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    const green = greens[Math.floor(rand() * greens.length)];
    if (rand() < 0.55) {
      dummy.position.y = h + 4.4 * s;
      dummy.updateMatrix();
      round.setMatrixAt(rounds, dummy.matrix);
      round.setColorAt(rounds++, green);
    } else {
      dummy.position.y = h + 5.4 * s;
      dummy.updateMatrix();
      pine.setMatrixAt(pines, dummy.matrix);
      pine.setColorAt(pines++, green);
    }
    placed++;
  }
  trunks.count = placed;
  round.count = rounds;
  pine.count = pines;
  group.add(trunks, round, pine);

  // far mountains, blue with distance
  const peaks = 16;
  const mountain = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshLambertMaterial({ flatShading: true }), peaks * 2);
  const rock = new THREE.Color('#7f8df5');
  const snow = new THREE.Color('#f4f8ff');
  for (let i = 0; i < peaks; i++) {
    const angle = (i / peaks) * Math.PI * 2 + rand() * 0.25;
    const dist = 400 + rand() * 90;
    const height = 95 + rand() * 90;
    const width = 70 + rand() * 55;
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.position.set(Math.cos(angle) * dist, height / 2 - 2, Math.sin(angle) * dist);
    dummy.scale.set(width, height, width);
    dummy.updateMatrix();
    mountain.setMatrixAt(i * 2, dummy.matrix);
    mountain.setColorAt(i * 2, rock);
    // the snow cap: the top quarter again, a touch larger
    dummy.position.y = height * 0.875 - 2 + 0.5;
    dummy.scale.set(width * 0.262, height * 0.25, width * 0.262);
    dummy.updateMatrix();
    mountain.setMatrixAt(i * 2 + 1, dummy.matrix);
    mountain.setColorAt(i * 2 + 1, snow);
  }
  group.add(mountain);
  return group;
}

// ---------------------------------------------------------------------------
// Clouds
// ---------------------------------------------------------------------------

const PUFF = new THREE.IcosahedronGeometry(1, 2);
const cloudMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#8fb6ea', emissiveIntensity: 0.38, fog: false });

/** One cloud: a handful of overlapping balls, flat underneath. Returns their matrices. */
function cloudPuffs(rand: () => number, width: number, into: THREE.Matrix4[], at: THREE.Vector3, turn: number): void {
  const dummy = new THREE.Object3D();
  const puffs = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < puffs; i++) {
    const along = (i / (puffs - 1) - 0.5) * width;
    const middle = 1 - Math.abs(i / (puffs - 1) - 0.5) * 1.3;
    const r = width * (0.16 + 0.13 * middle + rand() * 0.04);
    dummy.position.set(along, r * 0.45, (rand() - 0.5) * width * 0.16).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn).add(at);
    dummy.scale.set(r, r * 0.72, r);
    dummy.updateMatrix();
    into.push(dummy.matrix.clone());
  }
}

function createClouds(): THREE.InstancedMesh {
  const rand = seeded(5);
  const matrices: THREE.Matrix4[] = [];
  const at = new THREE.Vector3();
  for (let i = 0; i < 32; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 38 + rand() * 170;
    // around the player and all the way down: the fall goes through them
    at.set(Math.cos(angle) * dist, -75 + rand() * 105, Math.sin(angle) * dist);
    // nothing drifts in front of the cloud with the problem on it
    if (at.z < 0 && Math.abs(at.x) < 0.55 * -at.z && at.y > -6) at.y = -8 - rand() * 8;
    cloudPuffs(rand, 9 + rand() * 16, matrices, at, angle + Math.PI / 2);
  }
  const clouds = new THREE.InstancedMesh(PUFF, cloudMaterial, matrices.length);
  matrices.forEach((m, i) => clouds.setMatrixAt(i, m));
  clouds.frustumCulled = false;
  return clouds;
}

// ---------------------------------------------------------------------------
// Tower
// ---------------------------------------------------------------------------

/** The standing place that never breaks off: the blunt tip of the rock needle. */
const INNER = 0.42;
const OUTER = 0.98;
/**
 * The ledge around the tip, in cross-section: a wedge. A thin rim at the outer edge, deep where it
 * leans on the needle. Under a piece that has fallen there is no shelf left – only the steep side
 * of the needle and the drop.
 */
const RIM = 0.16;
const RIM_RADIUS = 0.93;
const ROOT = 1.25;
const ROOT_RADIUS = 0.4;
/** The pieces reach a little into the needle, so no gap shows between the two. */
const TUCK = 0.38;
const PIECES = 9;
const GRAVITY = 9.8;
/**
 * How far the tower leans towards the breaking side on a mistake (radians), and for how long.
 * The player stands on it, so what they see is the horizon tipping – a tilt of the floor alone
 * goes unnoticed. Kept small and smooth: a rolling horizon is what makes people queasy.
 */
const LEAN = THREE.MathUtils.degToRad(3);
const LEAN_TIME = 1.5;

interface Piece {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  /** Direction away from the middle of the tower. */
  out: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  falling: boolean;
  delay: number;
}

export interface Tower {
  group: THREE.Group;
  /** Break off one third of the ledge (0 or 1; the last third goes with `collapse`). */
  crumble(stage: number): void;
  /** Everything goes down. */
  collapse(): void;
  reset(): void;
  update(dt: number): void;
  /** The level axis the tower is leaning around, and by how much right now (0 when upright). */
  leanAxis: THREE.Vector3;
  leanAngle(): number;
}

/** One piece of the ledge around the tip: a ring segment, a wedge in cross-section, grass on top. */
function ledgePiece(from: number, to: number): { geometry: THREE.BufferGeometry; centre: THREE.Vector3; out: THREE.Vector3 } {
  const steps = 5;
  const mid = (from + to) / 2;
  const centre = new THREE.Vector3(0.66 * Math.sin(mid), -0.3, -0.66 * Math.cos(mid));
  // angle 0 looks ahead (−z)
  const at = (a: number, r: number, y: number) => new THREE.Vector3(r * Math.sin(a), y, -r * Math.cos(a));
  const positions: number[] = [];
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const m = new THREE.Vector3();
  /** A four-cornered face; turned so that it looks away from the middle of the piece. */
  const face = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    m.addVectors(a, c).multiplyScalar(0.5).sub(centre);
    const corners = n.dot(m) >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const v of corners) positions.push(v.x - centre.x, v.y - centre.y, v.z - centre.z);
  };
  const ring = (r: number, y: number) => Array.from({ length: steps + 1 }, (_, i) => at(from + ((to - from) * i) / steps, r, y));
  const topIn = ring(TUCK, 0);
  const topOut = ring(OUTER, 0);
  const rimOut = ring(RIM_RADIUS, -RIM);
  const rootIn = ring(ROOT_RADIUS, -ROOT);
  // the grass first: it gets its own material
  for (let i = 0; i < steps; i++) face(topIn[i], topOut[i], topOut[i + 1], topIn[i + 1]);
  const grassVertices = positions.length / 3;
  for (let i = 0; i < steps; i++) {
    face(topOut[i], rimOut[i], rimOut[i + 1], topOut[i + 1]); // the rim
    face(rimOut[i], rootIn[i], rootIn[i + 1], rimOut[i + 1]); // the slanting underside
    face(rootIn[i], topIn[i], topIn[i + 1], rootIn[i + 1]); // the side against the needle
  }
  face(topIn[0], topOut[0], rimOut[0], rootIn[0]);
  face(topIn[steps], topOut[steps], rimOut[steps], rootIn[steps]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.addGroup(0, grassVertices, 0);
  geometry.addGroup(grassVertices, positions.length / 3 - grassVertices, 1);
  geometry.computeVertexNormals();
  return { geometry, centre, out: new THREE.Vector3(Math.sin(mid), 0, -Math.cos(mid)) };
}

function createTower(): Tower {
  const group = new THREE.Group();
  group.name = 'tower';
  const rand = seeded(23);
  const grass = new THREE.MeshLambertMaterial({ color: '#59d936' });
  const rockColors = ['#b39a86', '#a48b78', '#c0a892'];
  const rocks = rockColors.map((color) => new THREE.MeshLambertMaterial({ color, flatShading: true }));

  // the pillar: a needle whose blunt tip is the standing place, widening down to the hill. Near the
  // top it stays slim enough that someone looking down past the tip sees the drop, not rock.
  // The outline runs from the bottom up – that is what makes the surface face outwards.
  const core = new THREE.Group();
  const H = -GROUND_Y;
  const outline: [number, number][] = [
    [10.5, -H - 1],
    [6.2, -H + 5],
    [3.4, -0.74 * H],
    [2.1, -0.52 * H],
    [2.4, -0.38 * H],
    [1.45, -0.22 * H],
    [1.5, -0.1 * H],
    [0.82, -4.5],
    [0.55, -ROOT],
    [INNER, -0.02],
  ];
  const radiusAt = (y: number) => {
    for (let i = 1; i < outline.length; i++) {
      const [r0, y0] = outline[i - 1];
      const [r1, y1] = outline[i];
      if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
    return INNER;
  };
  const pillar = new THREE.Mesh(
    new THREE.LatheGeometry(outline.map(([r, y]) => new THREE.Vector2(r, y)), 9),
    new THREE.MeshLambertMaterial({ color: '#a8917e', flatShading: true }),
  );
  const cap = new THREE.Mesh(new THREE.CircleGeometry(INNER, 9), new THREE.MeshLambertMaterial({ color: '#c9a57a' }));
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = -0.02;
  cap.receiveShadow = true;
  pillar.receiveShadow = true;
  core.add(pillar, cap);
  // boulders sticking out of the pillar
  const boulder = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 22; i++) {
    const y = -16 - rand() * H * 0.78; // none near the top: nothing to hide the drop
    const t = -y / H;
    const r = radiusAt(y) * 0.92;
    const a = rand() * Math.PI * 2;
    const m = new THREE.Mesh(boulder, rocks[i % rocks.length]);
    m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    m.scale.setScalar(0.35 + rand() * 0.5 + t * 1.8);
    m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    core.add(m);
  }
  group.add(core);

  // the ledge: nine pieces, three break off per mistake
  const pieces: Piece[] = [];
  const span = (Math.PI * 2) / PIECES;
  const gap = 0.012;
  for (let i = 0; i < PIECES; i++) {
    const { geometry, centre, out } = ledgePiece(i * span + gap, (i + 1) * span - gap);
    const mesh = new THREE.Mesh(geometry, [grass, rocks[i % rocks.length]]);
    mesh.position.copy(centre);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    pieces.push({ mesh, home: centre, out, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), falling: false, delay: 0 });
  }

  let coreFalling = false;
  let coreSpeed = 0;
  // the lean: around the middle of the top, so the player's footing does not slide away
  const leanAxis = new THREE.Vector3(1, 0, 0);
  let leanTime = LEAN_TIME;

  const drop = (piece: Piece, delay: number) => {
    if (piece.falling) return;
    piece.falling = true;
    piece.delay = delay;
    piece.velocity.copy(piece.out).multiplyScalar(0.5 + rand() * 0.9).setY(0.6 + rand() * 0.8);
    piece.spin.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(5);
  };

  return {
    group,
    crumble(stage) {
      // pieces 0-2 are ahead on the right, 6-8 ahead on the left: the first two mistakes are seen
      const first = stage === 0 ? 0 : 6;
      for (let i = 0; i < 3; i++) drop(pieces[first + i], i * 0.16);
      // the top dips towards the breaking side: turn around the level axis square to it
      const out = pieces[first + 1].out;
      leanAxis.set(out.z, 0, -out.x);
      leanTime = 0;
    },
    collapse() {
      pieces.forEach((p, i) => drop(p, (i % 3) * 0.1));
      coreFalling = true;
      coreSpeed = 0;
    },
    reset() {
      for (const p of pieces) {
        p.falling = false;
        p.mesh.visible = true;
        p.mesh.position.copy(p.home);
        p.mesh.rotation.set(0, 0, 0);
      }
      coreFalling = false;
      core.position.set(0, 0, 0);
      core.rotation.set(0, 0, 0);
      leanTime = LEAN_TIME;
    },
    leanAxis,
    leanAngle() {
      // out in the first third, back slowly, once – no swinging to and fro, no jolt at either end
      const u = leanTime / LEAN_TIME;
      return u >= 1 ? 0 : (LEAN * (1 - Math.cos(2 * Math.PI * u ** 0.7))) / 2;
    },
    update(dt) {
      leanTime = Math.min(LEAN_TIME, leanTime + dt);
      for (const p of pieces) {
        if (!p.falling || !p.mesh.visible) continue;
        if (p.delay > 0) {
          // a moment of shaking before it lets go
          p.delay -= dt;
          p.mesh.position.copy(p.home).y += (Math.random() - 0.5) * 0.03;
          continue;
        }
        p.velocity.y -= GRAVITY * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        p.mesh.rotation.z += p.spin.z * dt;
        if (p.mesh.position.y < GROUND_Y) p.mesh.visible = false;
      }
      if (coreFalling) {
        coreSpeed += GRAVITY * 1.6 * dt;
        core.position.y -= coreSpeed * dt;
        core.rotation.z += 0.05 * dt;
        core.rotation.x += 0.03 * dt;
      }
    },
  };
}

// ---------------------------------------------------------------------------

export interface World {
  /** Sky: follows the camera, never moves with the fall. */
  sky: THREE.Mesh;
  /** Land, clouds and tower: this is what rushes upwards when the player falls. */
  group: THREE.Group;
  tower: Tower;
  /** Where the cloud with the problem hangs, in the group. */
  boardAnchor: THREE.Group;
  horizon: THREE.Color;
  update(dt: number): void;
}

export function createWorld(): World {
  const group = new THREE.Group();
  const tower = createTower();
  const clouds = createClouds();
  group.add(createLand(), clouds, tower.group);

  // the cloud that carries the problem: far ahead, a little above eye level
  const boardAnchor = new THREE.Group();
  boardAnchor.position.set(0, 4.4, -12);
  const matrices: THREE.Matrix4[] = [];
  const rand = seeded(2);
  cloudPuffs(rand, 12.5, matrices, new THREE.Vector3(0, -1.1, -5), 0);
  cloudPuffs(rand, 8, matrices, new THREE.Vector3(0.6, 0.6, -7), 0);
  const backing = new THREE.InstancedMesh(PUFF, cloudMaterial, matrices.length);
  matrices.forEach((m, i) => backing.setMatrixAt(i, m));
  backing.frustumCulled = false;
  // squashed front to back, so that no puff reaches in front of the writing
  backing.scale.z = 0.3;
  boardAnchor.add(backing);
  group.add(boardAnchor);

  return {
    sky: createSky(),
    group,
    tower,
    boardAnchor,
    horizon: new THREE.Color(HORIZON),
    update(dt) {
      clouds.rotation.y += dt * 0.004;
      tower.update(dt);
      // the tower leans, the player with it: for them the world tips the other way, around their
      // feet, while the tower stays put underfoot
      const lean = tower.leanAngle();
      group.quaternion.setFromAxisAngle(tower.leanAxis, -lean);
      tower.group.quaternion.setFromAxisAngle(tower.leanAxis, lean);
    },
  };
}
