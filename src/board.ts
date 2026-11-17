/**
 * The writing on the cloud: the problem, the lives and the score – drawn on a canvas and shown as
 * one big picture in the sky. Also draws the number on a box.
 */
import * as THREE from 'three';

export const DISPLAY_FONT = "'Baloo 2', 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";

const INK = '#14213d';
const GOOD = '#0fae4b';
const BAD = '#ff3b4e';
const GOLD = '#ffb703';

const W = 1280;
const H = 800;

export type BoardView =
  | { kind: 'title'; hint: string; best: number }
  | { kind: 'problem'; text: string; answer?: number; verdict?: 'good' | 'bad'; lives: number; score: number; level: number; levelUp?: boolean }
  | { kind: 'over'; score: number; best: number; record: boolean; hint: string };

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, full: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.beginPath();
  ctx.moveTo(0, 38);
  ctx.bezierCurveTo(-70, -10, -40, -62, 0, -28);
  ctx.bezierCurveTo(40, -62, 70, -10, 0, 38);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = full ? BAD : '#c3cedd';
  ctx.fill();
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? size * 0.2 : size * 0.5;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.restore();
}

/** Text with a fat white outline, so it reads on cloud and on sky alike. Shrinks to fit `maxWidth`. */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, maxWidth = W - 80, align: CanvasTextAlign = 'center'): number {
  let px = size;
  ctx.font = `800 ${px}px ${DISPLAY_FONT}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) {
    px = Math.floor((px * maxWidth) / width);
    ctx.font = `800 ${px}px ${DISPLAY_FONT}`;
  }
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(10, px * 0.16);
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return ctx.measureText(text).width;
}

export class Board {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private last: BoardView | null = null;

  constructor(anisotropy: number) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
    const width = 9.6;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, (width * H) / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false, fog: false }),
    );
    this.mesh.renderOrder = 5;
  }

  /** Draw again with the same content (the web font arrived). */
  redraw(): void {
    if (this.last) this.show(this.last);
  }

  show(view: BoardView): void {
    this.last = view;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    if (view.kind === 'title') {
      label(ctx, 'MATH LORD', W / 2, 220, 230, INK);
      label(ctx, 'Vágd szét a helyes eredményt!', W / 2, 425, 96, '#1568f0');
      label(ctx, view.hint, W / 2, 565, 96, INK);
      if (view.best > 0) this.score(view.best, W / 2, 705, 84, 'Rekord: ');
    } else if (view.kind === 'over') {
      label(ctx, 'Leomlott a torony!', W / 2, 160, 150, BAD);
      this.score(view.score, W / 2, 350, 160, '', ' pont');
      if (view.record) label(ctx, 'Új rekord!', W / 2, 520, 96, GOOD);
      else if (view.best > 0) label(ctx, `Rekord: ${view.best}`, W / 2, 520, 96, INK);
      label(ctx, view.hint, W / 2, 680, 92, INK);
    } else {
      // the problem: "3 + 2 = ?", and once it is decided, the answer in its place
      const answer = view.answer === undefined ? '?' : String(view.answer);
      const left = `${view.text} = `;
      const size = 300;
      ctx.font = `800 ${size}px ${DISPLAY_FONT}`;
      const full = ctx.measureText(left + answer).width;
      const px = Math.min(size, Math.floor((size * (W - 90)) / full));
      ctx.font = `800 ${px}px ${DISPLAY_FONT}`;
      const leftWidth = ctx.measureText(left).width;
      const start = (W - ctx.measureText(left + answer).width) / 2;
      label(ctx, left, start, 270, px, INK, W, 'left');
      const answerColor = view.answer === undefined ? '#1568f0' : view.verdict === 'bad' ? BAD : GOOD;
      label(ctx, answer, start + leftWidth, 270, px, answerColor, W, 'left');

      // underneath: lives on the left, score in the middle, level on the right
      for (let i = 0; i < 3; i++) heart(ctx, 130 + i * 140, 640, 128, i < view.lives);
      this.score(view.score, W / 2 + 60, 640, 128);
      label(ctx, view.levelUp ? `${view.level}. szint!` : `${view.level}. szint`, W - 50, 640, 108, view.levelUp ? GOOD : INK, 330, 'right');
    }
    this.texture.needsUpdate = true;
  }

  /** A star and a number, centred on x. */
  private score(value: number, x: number, y: number, size: number, before = '', after = ''): void {
    const ctx = this.ctx;
    const text = `${before}${value}${after}`;
    ctx.font = `800 ${size}px ${DISPLAY_FONT}`;
    const width = ctx.measureText(text).width;
    const gap = size * 0.25;
    const left = x - (size + gap + width) / 2;
    star(ctx, left + size / 2, y - size * 0.04, size * 1.1);
    label(ctx, text, left + size + gap, y, size, INK, W, 'left');
  }
}

/** The face of a box: a coloured crate with its number. */
export function drawBoxFace(canvas: HTMLCanvasElement, value: number, color: string): void {
  const s = canvas.width;
  const ctx = canvas.getContext('2d')!;
  const base = new THREE.Color(color);
  const dark = `#${base.clone().multiplyScalar(0.62).getHexString()}`;
  const light = `#${base.clone().lerp(new THREE.Color('#ffffff'), 0.28).getHexString()}`;
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = color;
  const edge = s * 0.085;
  ctx.fillRect(edge, edge, s - 2 * edge, s - 2 * edge);
  ctx.fillStyle = light;
  ctx.fillRect(edge, edge, s - 2 * edge, s * 0.06);
  const text = String(value);
  const px = s * [0, 0.74, 0.6, 0.43, 0.33][Math.min(4, text.length)];
  ctx.font = `800 ${px}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = px * 0.2;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, s / 2, s * 0.54);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, s / 2, s * 0.54);
}
