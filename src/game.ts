/**
 * The game itself: a problem on the cloud, five numbered boxes rising on balloons, a sword.
 * Cut the box with the right answer; a wrong cut or letting them all fly off costs a piece of the
 * tower, and the third mistake brings the tower – and the player – down.
 */
import * as THREE from 'three';
import { sfx } from './audio';
import { Board, drawBoxFace } from './board';
import { ALL_OPS, levelFor, makeChoices, makeProblem, type Level, type Op, type Problem } from './math';
import type { World } from './world';

export type GameState = 'idle' | 'playing' | 'resolving' | 'falling' | 'over';
export type Mode = 'screen' | 'vr';

const SLOTS = 5;
/** The boxes rise on an arc in front of the player, just beyond the edge of the tower. */
const RADIUS = 1.15;
const SPREAD = THREE.MathUtils.degToRad(34);
const BOX = 0.3;
const BALLOON_Y = 0.74;
const BALLOON_R = 0.2;
/** A new set of boxes shoots up from below the ledge, then drifts. */
const RISE_FROM = -3.2;
const RISE_TO = -0.3;
const RISE_TIME = 1;
/** The boxes do not come up together: each one starts a little later and hangs a little lower than the one before. */
const STAGGER_TIME = 0.35;
const STAGGER_Y = 0.2;
/** Above this height a box is out of reach: once the right one is up there, the problem is lost. */
const MISS_Y = 2.45;
/** The fall: the tower shakes, then the player drops; the picture whites out before the end. */
const FALL_SHAKE = 0.7;
const FALL_WHITE = 3.1;
const FALL_END = 4.2;
/** Drift in metres per second: harder levels leave more time to think. */
const DRIFT: Record<Level, number> = { 1: 0.25, 2: 0.19, 3: 0.14 };
/** The blade only cuts while it moves at least this fast (m/s): resting it on a box does nothing. */
const SWING_MIN = 0.7;
const LIVES = 3;
const COLORS = ['#ff3d68', '#ff9f1c', '#22c55e', '#22b8f0', '#a855f7'];

type Phase = 'off' | 'rise' | 'shrink' | 'pulse' | 'away';

interface Crate {
  group: THREE.Group;
  box: THREE.Mesh;
  balloon: THREE.Mesh;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  side: THREE.MeshLambertMaterial;
  plain: THREE.MeshLambertMaterial;
  skin: THREE.MeshPhongMaterial;
  color: THREE.Color;
  value: number;
  phase: Phase;
  /** Place in the order the boxes come up: 0 is first and highest. */
  rank: number;
  wobble: number;
  speed: number;
}

interface Half {
  mesh: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

/** Small tumbling bits of paper for a burst balloon and a split box. */
class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private readonly bits: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3; life: number }[] = [];
  private next = 0;
  private dummy = new THREE.Object3D();

  constructor(count = 180) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 0.006), new THREE.MeshLambertMaterial(), count);
    this.mesh.frustumCulled = false;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < count; i++) {
      this.bits.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), s: new THREE.Vector3(), life: 0 });
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, new THREE.Color('#ffffff'));
    }
  }

  burst(at: THREE.Vector3, color: THREE.Color, count: number, speed: number): void {
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const index = this.next;
      const bit = this.bits[index];
      this.next = (this.next + 1) % this.bits.length;
      bit.p.copy(at);
      bit.v.randomDirection().multiplyScalar(speed * (0.35 + Math.random() * 0.65));
      bit.v.y += speed * 0.4;
      bit.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      bit.s.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      bit.life = 0.8 + Math.random() * 0.6;
      tint.copy(color).offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.25);
      this.mesh.setColorAt(index, tint);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    let changed = false;
    this.bits.forEach((bit, i) => {
      if (bit.life <= 0) return;
      changed = true;
      bit.life -= dt;
      bit.v.y -= 3.2 * dt;
      bit.v.multiplyScalar(1 - 1.8 * dt);
      bit.p.addScaledVector(bit.v, dt);
      bit.r.x += bit.s.x * dt;
      bit.r.y += bit.s.y * dt;
      this.dummy.position.copy(bit.p);
      this.dummy.rotation.copy(bit.r);
      this.dummy.scale.setScalar(bit.life <= 0 ? 0 : Math.min(1, bit.life * 3));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    });
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** The sword: the blade points along −z from the hand, its edges up and down. */
export function createSword(): { group: THREE.Group; hilt: THREE.Vector3; tip: THREE.Vector3 } {
  const group = new THREE.Group();
  const outline = new THREE.Shape();
  outline.moveTo(-0.032, 0);
  outline.lineTo(0.032, 0);
  outline.lineTo(0.03, 0.74);
  outline.lineTo(0, 0.86);
  outline.lineTo(-0.03, 0.74);
  outline.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(outline, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  bladeGeometry.translate(0, 0, -0.006);
  bladeGeometry.rotateX(-Math.PI / 2); // length → −z
  bladeGeometry.rotateZ(Math.PI / 2); // flat sides left and right
  const blade = new THREE.Mesh(bladeGeometry, new THREE.MeshPhongMaterial({ color: '#eaf6ff', emissive: '#2f8dff', emissiveIntensity: 0.45, shininess: 90, flatShading: true }));
  blade.position.z = -0.012;
  const gold = new THREE.MeshPhongMaterial({ color: '#ffc21a', emissive: '#a35a00', emissiveIntensity: 0.35, shininess: 60 });
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.028), gold);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.13, 10), new THREE.MeshLambertMaterial({ color: '#7a3cff' }));
  grip.rotation.x = Math.PI / 2;
  grip.position.z = 0.078;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), gold);
  pommel.position.z = 0.155;
  group.add(blade, guard, grip, pommel);
  group.traverse((o) => {
    o.castShadow = true;
  });
  return { group, hilt: new THREE.Vector3(0, 0, -0.02), tip: new THREE.Vector3(0, 0, -0.87) };
}

function loadBest(): number {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem('math-lord-best')) || 0));
  } catch {
    return 0;
  }
}

export interface GameOptions {
  anisotropy: number;
  /** Shake the hand that holds the sword. */
  pulse(strength: number, ms: number): void;
  onState(state: GameState): void;
}

export class Game {
  state: GameState = 'idle';
  mode: Mode = 'screen';
  ops: Op[] = [...ALL_OPS];
  score = 0;
  best = loadBest();
  lives = LIVES;
  level: Level = 1;
  problem: Problem | null = null;
  /** Which box carries the right answer. */
  correct = -1;

  readonly board: Board;
  private crates: Crate[] = [];
  private halves: Half[] = [];
  private confetti = new Confetti();
  private veil: THREE.Mesh;
  private veilMaterial: THREE.MeshBasicMaterial;
  private veilAlpha = 0;

  private frame = 0;
  private waveTime = 0;
  private timer = 0;
  private fallTime = 0;
  private fallSpeed = 0;
  private overTime = 0;
  private levelUp = false;

  private blade = { active: false, fresh: true, hilt: new THREE.Vector3(), tip: new THREE.Vector3(), lastTip: new THREE.Vector3(), swing: 0 };
  private line = new THREE.Line3();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private world: World,
    private options: GameOptions,
  ) {
    this.board = new Board(options.anisotropy);
    world.boardAnchor.add(this.board.mesh);

    const boxGeometry = new THREE.BoxGeometry(BOX, BOX, BOX);
    const balloonGeometry = new THREE.SphereGeometry(BALLOON_R, 20, 14);
    const knotGeometry = new THREE.ConeGeometry(0.03, 0.05, 8);
    const stringGeometry = new THREE.CylinderGeometry(0.004, 0.004, 1, 5);
    const stringMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    for (let i = 0; i < SLOTS; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = options.anisotropy;
      const side = new THREE.MeshLambertMaterial({ map: texture });
      const plain = new THREE.MeshLambertMaterial();
      const skin = new THREE.MeshPhongMaterial({ shininess: 120, specular: '#ffffff' });
      const group = new THREE.Group();
      // faces: +x, −x, +y, −y, +z, −z – the number is on the four sides
      const box = new THREE.Mesh(boxGeometry, [side, side, plain, plain, side, side]);
      const balloon = new THREE.Mesh(balloonGeometry, skin);
      balloon.scale.set(1, 1.18, 1);
      balloon.position.y = BALLOON_Y;
      const knot = new THREE.Mesh(knotGeometry, skin);
      knot.position.y = -BALLOON_R - 0.012;
      balloon.add(knot);
      const string = new THREE.Mesh(stringGeometry, stringMaterial);
      const from = BOX / 2;
      const to = BALLOON_Y - BALLOON_R * 1.18;
      string.scale.y = to - from;
      string.position.y = (from + to) / 2;
      box.castShadow = box.receiveShadow = balloon.castShadow = true;
      box.userData.slot = balloon.userData.slot = i;
      group.add(box, balloon, string);
      group.visible = false;
      scene.add(group);
      this.crates.push({ group, box, balloon, canvas, texture, side, plain, skin, color: new THREE.Color(), value: 0, phase: 'off', rank: 0, wobble: 0, speed: 0 });
    }

    const halfGeometry = new THREE.BoxGeometry(BOX / 2, BOX, BOX);
    for (let i = 0; i < 4; i++) {
      const material = new THREE.MeshLambertMaterial();
      const mesh = new THREE.Mesh(halfGeometry, material);
      mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      this.halves.push({ mesh, material, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
    scene.add(this.confetti.mesh);

    // a veil right around the head: flashes red on a mistake, whites out the end of the fall
    this.veilMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.veil = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 8), this.veilMaterial);
    this.veil.renderOrder = 1000;
    this.veil.frustumCulled = false;
    this.veil.visible = false;
    scene.add(this.veil);

    this.showTitle();
  }

  // -- from outside ----------------------------------------------------------

  setMode(mode: Mode): void {
    this.mode = mode;
    if (this.state === 'idle') this.showTitle();
  }

  /** Stop whatever is going on and show the title on the cloud. */
  toIdle(): void {
    this.clearCrates();
    this.world.group.position.set(0, 0, 0);
    this.world.tower.reset();
    this.veilAlpha = 0;
    this.setState('idle');
    this.showTitle();
  }

  start(): void {
    this.clearCrates();
    this.world.group.position.set(0, 0, 0);
    this.world.tower.reset();
    this.score = 0;
    this.lives = LIVES;
    this.level = 1;
    this.levelUp = false;
    this.problem = null;
    sfx.start();
    this.nextWave();
  }

  /** The trigger of a controller: starts a game from the title and from the end. */
  trigger(): boolean {
    if (this.state === 'idle' || (this.state === 'over' && this.overTime > 1)) {
      this.start();
      return true;
    }
    return false;
  }

  /** What a click on the flat screen can hit: boxes and balloons, each tagged with its slot. */
  targets(): THREE.Object3D[] {
    return this.crates.filter((c) => c.phase === 'rise' && this.age(c) > 0.35).flatMap((c) => [c.box, c.balloon]);
  }

  /** A click or tap on a box (flat screen). */
  pick(slot: number): void {
    if (this.state === 'playing' && this.crates[slot]?.phase === 'rise') this.cut(slot);
  }

  /** Where the blade is this frame, in world space – or null without a sword. */
  setBlade(hilt: THREE.Vector3 | null, tip?: THREE.Vector3): void {
    const b = this.blade;
    if (!hilt || !tip) {
      b.active = false;
      b.fresh = true;
      return;
    }
    b.active = true;
    b.hilt.copy(hilt);
    b.tip.copy(tip);
  }

  update(dt: number, time: number, head: THREE.Vector3): void {
    this.frame++;
    this.world.update(dt);
    this.swing(dt);

    if (this.state === 'playing') {
      this.waveTime += dt;
      if (this.height(this.crates[this.correct]) > MISS_Y) this.mistake();
    } else if (this.state === 'resolving') {
      this.timer -= dt;
      if (this.timer <= 0) {
        for (const c of this.crates) if (c.phase === 'pulse') c.phase = 'away';
        if (this.lives <= 0) this.beginFall();
        else this.nextWave();
      }
    } else if (this.state === 'falling') {
      this.fall(dt);
    } else if (this.state === 'over') {
      this.overTime += dt;
    }

    for (const c of this.crates) this.moveCrate(c, dt, time);
    for (const h of this.halves) {
      if (h.life <= 0) continue;
      h.life -= dt;
      h.velocity.y -= 9.8 * dt;
      h.mesh.position.addScaledVector(h.velocity, dt);
      h.mesh.rotation.x += h.spin.x * dt;
      h.mesh.rotation.y += h.spin.y * dt;
      h.mesh.rotation.z += h.spin.z * dt;
      if (h.life <= 0) h.mesh.visible = false;
    }
    this.confetti.update(dt);

    if (this.state !== 'falling') this.veilAlpha = Math.max(0, this.veilAlpha - dt * 1.3);
    this.veil.visible = this.veilAlpha > 0.004;
    this.veilMaterial.opacity = this.veilAlpha;
    this.veil.position.copy(head);
  }

  /** For the smoke test and the debug hook. */
  snapshot() {
    return {
      state: this.state,
      frame: this.frame,
      waveTime: this.waveTime,
      /** Every box has finished shooting up. */
      risen: this.state === 'playing' && this.waveTime > (SLOTS - 1) * STAGGER_TIME + RISE_TIME + 0.2,
      score: this.score,
      lives: this.lives,
      level: this.level,
      problem: this.problem?.text ?? '',
      answer: this.problem?.answer ?? null,
      correct: this.correct,
      crates: this.crates.map((c) => ({ value: c.value, phase: c.phase, x: c.group.position.x, y: c.group.position.y, z: c.group.position.z })),
      worldY: this.world.group.position.y,
    };
  }

  // -- the round ---------------------------------------------------------------

  private setState(state: GameState): void {
    if (state === this.state) return;
    this.state = state;
    this.options.onState(state);
  }

  private showTitle(): void {
    this.board.show({ kind: 'title', hint: this.mode === 'vr' ? 'Húzd meg a ravaszt!' : 'Indítsd el a játékot!', best: this.best });
  }

  private showProblem(decided?: 'good' | 'bad'): void {
    if (!this.problem) return;
    this.board.show({
      kind: 'problem',
      text: this.problem.text,
      answer: decided ? this.problem.answer : undefined,
      verdict: decided,
      lives: this.lives,
      score: this.score,
      level: this.level,
      levelUp: this.levelUp,
    });
  }

  private nextWave(): void {
    this.problem = makeProblem(this.level, this.ops, Math.random, this.problem?.text);
    const choices = makeChoices(this.problem, SLOTS);
    this.correct = choices.indexOf(this.problem.answer);
    const colors = [...COLORS].sort(() => Math.random() - 0.5);
    const order = this.crates.map((_, i) => i).sort(() => Math.random() - 0.5);
    this.crates.forEach((c, i) => {
      const angle = (i - (SLOTS - 1) / 2) * SPREAD;
      c.value = choices[i];
      c.color.set(colors[i]);
      drawBoxFace(c.canvas, c.value, colors[i]);
      c.texture.needsUpdate = true;
      c.plain.color.copy(c.color).multiplyScalar(0.8);
      c.skin.color.copy(c.color);
      c.skin.emissive.copy(c.color).multiplyScalar(0.25);
      c.group.position.set(RADIUS * Math.sin(angle), RISE_FROM, -RADIUS * Math.cos(angle));
      c.group.rotation.set(0, -angle, 0);
      c.group.scale.setScalar(1);
      c.group.visible = true;
      c.box.visible = c.balloon.visible = true;
      c.phase = 'rise';
      c.rank = order[i];
      c.wobble = Math.random() * 6.28;
      c.speed = 0;
    });
    this.waveTime = 0;
    this.showProblem();
    this.levelUp = false;
    sfx.rise();
    this.setState('playing');
  }

  /** How long a box has been on its way. */
  private age(c: Crate): number {
    return this.waveTime - c.rank * STAGGER_TIME;
  }

  /** Height of a box: it waits its turn below, shoots up, then drifts. */
  private height(c: Crate): number {
    const t = this.age(c);
    if (t <= 0) return RISE_FROM;
    const top = RISE_TO - c.rank * STAGGER_Y;
    if (t < RISE_TIME) return RISE_FROM + (top - RISE_FROM) * (1 - (1 - t / RISE_TIME) ** 3);
    return top + (t - RISE_TIME) * DRIFT[this.level];
  }

  private moveCrate(c: Crate, dt: number, time: number): void {
    if (c.phase === 'off') return;
    const g = c.group;
    if (c.phase === 'rise' || c.phase === 'pulse') {
      if (this.state === 'playing') g.position.y = this.height(c) + Math.sin(time * 1.7 + c.wobble) * 0.02;
      g.rotation.z = Math.sin(time * 1.3 + c.wobble) * 0.05;
      if (c.phase === 'pulse') g.scale.setScalar(1 + 0.2 * Math.abs(Math.sin(time * 6)));
    } else if (c.phase === 'shrink') {
      const s = g.scale.x - dt * 4.5;
      if (s <= 0) this.hide(c);
      else g.scale.setScalar(s);
    } else if (c.phase === 'away') {
      c.speed += 10 * dt;
      g.position.y += c.speed * dt;
      if (g.position.y > 16) this.hide(c);
    }
  }

  private hide(c: Crate): void {
    c.phase = 'off';
    c.group.visible = false;
  }

  private clearCrates(): void {
    for (const c of this.crates) this.hide(c);
    for (const h of this.halves) {
      h.life = 0;
      h.mesh.visible = false;
    }
  }

  /** The blade against the boxes and balloons: any touch while it is swung counts as a cut. */
  private swing(dt: number): void {
    const b = this.blade;
    if (!b.active) return;
    if (b.fresh) {
      b.fresh = false;
      b.lastTip.copy(b.tip);
      b.swing = 0;
    }
    b.swing = Math.max(b.tip.distanceTo(b.lastTip) / Math.max(dt, 1e-3), b.swing * 0.8);
    if (this.state === 'playing' && b.swing >= SWING_MIN) {
      for (let i = 0; i < this.crates.length; i++) {
        const c = this.crates[i];
        if (c.phase !== 'rise' || this.age(c) < 0.35) continue;
        const box = c.group.position;
        const balloon = this.v2.copy(box).setY(box.y + BALLOON_Y);
        // the blade as it is now, and the path its tip took since the last frame
        if (
          this.near(b.hilt, b.tip, box) < BOX * 0.62 ||
          this.near(b.hilt, b.tip, balloon) < BALLOON_R * 1.1 ||
          this.near(b.lastTip, b.tip, box) < BOX * 0.62 ||
          this.near(b.lastTip, b.tip, balloon) < BALLOON_R * 1.1
        ) {
          this.options.pulse(0.9, 70);
          this.cut(i);
          break;
        }
      }
    }
    b.lastTip.copy(b.tip);
  }

  private near(from: THREE.Vector3, to: THREE.Vector3, point: THREE.Vector3): number {
    this.line.set(from, to);
    return this.line.closestPointToPoint(point, true, this.v).distanceTo(point);
  }

  private cut(slot: number): void {
    const c = this.crates[slot];
    const at = c.group.position;
    // the box falls apart in two halves, the balloon bursts
    const side = this.v.set(Math.cos(c.group.rotation.y), 0, -Math.sin(c.group.rotation.y));
    const free = this.halves.filter((h) => h.life <= 0).slice(0, 2);
    free.forEach((h, i) => {
      const dir = i ? 1 : -1;
      h.material.color.copy(c.color);
      h.mesh.visible = true;
      h.mesh.position.copy(at).addScaledVector(side, dir * BOX * 0.25);
      h.mesh.rotation.copy(c.group.rotation);
      h.velocity.copy(side).multiplyScalar(dir * 1.1).setY(1.4);
      h.spin.set(Math.random() - 0.5, Math.random() - 0.5, -dir * 1.6).multiplyScalar(4);
      h.life = 1.6;
    });
    this.confetti.burst(at, c.color, 16, 1.6);
    this.confetti.burst(this.v2.copy(at).setY(at.y + BALLOON_Y), c.color, 26, 2.6);
    this.hide(c);
    sfx.cut();
    if (slot === this.correct) this.success();
    else this.mistake();
  }

  private success(): void {
    this.score++;
    if (this.score > this.best) this.saveBest();
    const level = levelFor(this.score);
    if (level > this.level) {
      this.level = level;
      this.levelUp = true;
      sfx.levelUp();
    }
    sfx.correct();
    for (const c of this.crates) if (c.phase === 'rise') c.phase = 'shrink';
    this.showProblem('good');
    this.timer = this.levelUp ? 1.8 : 1.0;
    this.setState('resolving');
  }

  /** A wrong box was cut, or all of them got away. */
  private mistake(): void {
    this.lives--;
    sfx.wrong();
    this.options.pulse(1, 350);
    this.veilMaterial.color.set('#ff2a3c');
    this.veilAlpha = 0.38;
    // the right box stays and pulses, so the answer is seen as well as read
    this.crates.forEach((c, i) => {
      if (c.phase === 'rise') c.phase = i === this.correct ? 'pulse' : 'shrink';
    });
    if (this.lives > 0) {
      this.world.tower.crumble(LIVES - this.lives - 1);
      sfx.crumble();
    }
    this.showProblem('bad');
    // long enough to read the right answer; the last mistake goes straight on to the collapse
    this.timer = this.lives > 0 ? 2.3 : 1.5;
    this.setState('resolving');
  }

  private saveBest(): void {
    this.best = this.score;
    try {
      localStorage.setItem('math-lord-best', String(this.best));
    } catch {
      /* private window: the record is just not remembered */
    }
  }

  // -- the end -----------------------------------------------------------------

  private record = false;

  private beginFall(): void {
    this.record = this.score > 0 && this.score >= this.best;
    this.fallTime = 0;
    this.fallSpeed = 0;
    this.world.tower.collapse();
    sfx.collapse();
    this.options.pulse(1, 900);
    this.veilMaterial.color.set('#ffffff');
    this.setState('falling');
  }

  private fall(dt: number): void {
    this.fallTime += dt;
    const group = this.world.group;
    if (this.fallTime < FALL_SHAKE) {
      // the ground shakes before it gives way
      group.position.x = (Math.random() - 0.5) * 0.02;
      group.position.z = (Math.random() - 0.5) * 0.02;
    } else {
      // the player falls: for them, the world rushes up
      group.position.x = group.position.z = 0;
      this.fallSpeed += 9.8 * dt;
      group.position.y += this.fallSpeed * dt;
    }
    this.veilAlpha = THREE.MathUtils.smoothstep(this.fallTime, FALL_WHITE, FALL_END - 0.2);
    if (this.fallTime >= FALL_END) {
      group.position.set(0, 0, 0);
      this.world.tower.reset();
      this.clearCrates();
      this.overTime = 0;
      this.board.show({
        kind: 'over',
        score: this.score,
        best: this.best,
        record: this.record,
        hint: this.mode === 'vr' ? 'Új játék: húzd meg a ravaszt!' : 'Próbáld meg újra!',
      });
      this.setState('over');
    }
  }
}
