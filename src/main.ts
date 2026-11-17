/**
 * Page, renderer and headset session. The picture settings (resolution steps, edge blur, crisp
 * single-sample shadow, "local-floor") are the ones worked out for the Gardrób VR viewer.
 */
import * as THREE from 'three';
import './shadowPatch';
import './style.css';
import { unlockAudio } from './audio';
import { DISPLAY_FONT } from './board';
import { createSword, Game, type GameState } from './game';
import { ALL_OPS, type Op } from './math';
import { createWorld } from './world';

declare const __BUILD__: string;

/** Resolution of the headset picture, as multiples of what the headset recommends. */
const RES_STEPS = [0.75, 1, 1.25, 1.5];
/** Edge blur (fixed foveation): 0 keeps the whole picture sharp, the rest save drawing time. */
const FOVEATION_STEPS = [0, 1 / 3, 2 / 3, 1];
const FOVEATION_NAMES = ['nincs', 'enyhe', 'közepes', 'erős'];

type Hand = 'left' | 'right';
type Support = 'checking' | 'yes' | 'no' | 'blocked' | 'none';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window: the choice is just not remembered */
  }
}

function crash(message: string): void {
  const p = document.createElement('p');
  p.className = 'crash';
  p.textContent = message;
  document.body.append(p);
}

function boot(): void {
  const canvas = $<HTMLCanvasElement>('view');
  const stage = $('stage');
  const card = $('card');

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    crash(`Ez a böngésző nem tud 3D-t rajzolni (${(e as Error)?.message ?? e}).`);
    return;
  }
  renderer.xr.enabled = true;
  renderer.toneMapping = THREE.NoToneMapping; // the colours stay as loud as they were picked
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const world = createWorld();
  scene.background = world.horizon;
  scene.fog = new THREE.Fog(world.horizon, 170, 640);
  scene.add(world.sky, world.group);

  // light: a coloured sky light, and a sun whose shadow only covers the top of the tower
  scene.add(new THREE.HemisphereLight('#d9efff', '#69c26a', 2.1));
  const sun = new THREE.DirectionalLight('#fff1cf', 2.5);
  // from ahead, where the sky has its sun: boxes and balloons throw their shadow onto the tower top
  sun.position.set(3.2, 5.2, -5.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.006;
  sun.shadow.radius = 0;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -2.6;
  sc.right = sc.top = 2.6;
  sc.near = 1;
  sc.far = 16;
  scene.add(sun, sun.target);

  // the near plane no closer than needed: every halving of it halves the depth precision far away
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1300);
  scene.add(camera);

  let presenting = false;
  let playingOnScreen = false;

  // -- hands -------------------------------------------------------------------

  // The sword sits in the headset's "grip" space, not on the pointing ray: the grip is the hand
  // itself, its −z running through the fist from the little finger to the thumb – the line of the
  // controller's handle. (On a Quest Touch controller that is 45° above where the controller
  // points.) So the blade continues the handle exactly, whatever the controller.
  const sword = createSword();
  /** Extra lean of the blade, in degrees: above 0 it tips back towards the player, below 0 forward. */
  const SWORD_TILT = 0;
  sword.group.rotation.x = THREE.MathUtils.degToRad(SWORD_TILT);
  // the guard just above the fist, the handle through the palm
  sword.group.position.set(0, 0, -0.055);
  let swordHand: Hand = stored('math-lord-hand') === 'left' ? 'left' : 'right';
  const controllers = [0, 1].map((i) => {
    const controller = renderer.xr.getController(i); // events, and which hand it is
    const grip = renderer.xr.getControllerGrip(i); // where the hand is
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 10), new THREE.MeshPhongMaterial({ color: '#ffffff', emissive: '#22b8f0', emissiveIntensity: 0.5 }));
    orb.name = 'orb';
    grip.add(orb);
    controller.userData.grip = grip;
    scene.add(controller, grip);
    return controller;
  });
  const gripOf = (c: THREE.Object3D) => c.userData.grip as THREE.Group;
  const holder = () =>
    controllers.find((c) => c.userData.hand === swordHand) ?? controllers.find((c) => c.userData.hand) ?? null;
  const placeSword = () => {
    const h = holder();
    if (h) gripOf(h).add(sword.group);
    else sword.group.removeFromParent();
    for (const c of controllers) gripOf(c).getObjectByName('orb')!.visible = !!c.userData.hand && c !== h;
  };
  const pulse = (strength: number, ms: number) => {
    try {
      const pad = (holder()?.userData.source as XRInputSource | undefined)?.gamepad as (Gamepad & { hapticActuators?: { pulse(v: number, ms: number): unknown }[] }) | undefined;
      void pad?.hapticActuators?.[0]?.pulse(strength, ms);
    } catch {
      /* no rumble on this controller */
    }
  };

  // -- game --------------------------------------------------------------------

  const best = $('best');
  const result = $('result');
  const menu = $('menu');
  const showCard = () => {
    card.hidden = presenting || playingOnScreen;
    menu.hidden = !playingOnScreen || presenting;
    best.textContent = game.best > 0 ? `Rekord: ${game.best} pont` : '';
  };
  const onState = (state: GameState) => {
    if (state === 'over' && !presenting) {
      playingOnScreen = false;
      result.hidden = false;
      result.textContent = `Leomlott a torony! ${game.score} pontot szereztél.`;
      $('play-screen').textContent = 'Új játék képernyőn';
    }
    showCard();
  };
  const game = new Game(scene, world, { anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()), pulse, onState });
  // the cloud is drawn with a web font: draw it again when the font is there
  void document.fonts?.load(`800 100px ${DISPLAY_FONT}`).then(() => game.board.redraw());

  for (const controller of controllers) {
    const events = controller as unknown as THREE.EventDispatcher<Record<string, { data?: XRInputSource }>>;
    events.addEventListener('connected', (e) => {
      controller.userData.hand = e.data?.handedness === 'left' ? 'left' : 'right';
      controller.userData.source = e.data;
      placeSword();
    });
    events.addEventListener('disconnected', () => {
      controller.userData.hand = controller.userData.source = undefined;
      placeSword();
    });
    events.addEventListener('selectstart', () => {
      const hand = controller.userData.hand as Hand | undefined;
      if (!hand) return;
      unlockAudio();
      // the hand that starts the game gets the sword; later the other trigger takes it over
      if (game.trigger() || game.state === 'playing' || game.state === 'resolving') {
        swordHand = hand;
        store('math-lord-hand', hand);
        placeSword();
      }
    });
  }

  // -- settings ----------------------------------------------------------------

  const savedOps = stored('math-lord-ops');
  if (savedOps) {
    const ops = ALL_OPS.filter((op) => savedOps.includes(op));
    if (ops.length) game.ops = ops;
  }
  const opButtons = [...document.querySelectorAll<HTMLButtonElement>('.ops button')];
  const paintOps = () => opButtons.forEach((b) => b.setAttribute('aria-pressed', String(game.ops.includes(b.dataset.op as Op))));
  for (const button of opButtons) {
    button.addEventListener('click', () => {
      const op = button.dataset.op as Op;
      const next = game.ops.includes(op) ? game.ops.filter((o) => o !== op) : ALL_OPS.filter((o) => o === op || game.ops.includes(o));
      if (!next.length) return; // one operation always stays
      game.ops = next;
      store('math-lord-ops', next.join(''));
      paintOps();
    });
  }
  paintOps();

  let resolution = Number(stored('math-lord-res'));
  if (!RES_STEPS.includes(resolution)) resolution = 1;
  let foveation = Number(stored('math-lord-fov') ?? 0);
  if (!Number.isInteger(foveation) || foveation < 0 || foveation >= FOVEATION_STEPS.length) foveation = 0;
  const segment = (id: string, names: string[], current: () => number, choose: (index: number) => void) => {
    const box = $(id);
    const paint = () => [...box.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === current())));
    names.forEach((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `${id}-${i}`;
      b.textContent = name;
      b.addEventListener('click', () => {
        choose(i);
        paint();
      });
      box.append(b);
    });
    paint();
  };
  segment('res', RES_STEPS.map((s) => `${s}×`), () => RES_STEPS.indexOf(resolution), (i) => {
    resolution = RES_STEPS[i];
    store('math-lord-res', String(resolution));
  });
  segment('fov', FOVEATION_NAMES, () => foveation, (i) => {
    foveation = i;
    store('math-lord-fov', String(i));
  });
  $('build').textContent = __BUILD__;

  // -- flat screen -------------------------------------------------------------

  const resize = () => {
    if (renderer.xr.isPresenting) return;
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // far enough back that all five boxes fit side by side, on a phone held upright too
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const back = Math.max(1.5, 1.3 / Math.tan(half) - 0.43);
    camera.position.set(0, 1.75 + (back - 1.5) * 0.1, back);
    camera.lookAt(0, 1.4, -1.2);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    if (presenting || game.state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(game.targets(), false)[0];
    if (hit) game.pick(hit.object.userData.slot as number);
  });

  $('play-screen').addEventListener('click', () => {
    unlockAudio();
    playingOnScreen = true;
    result.hidden = true;
    game.setMode('screen');
    game.start();
    showCard();
  });
  menu.addEventListener('click', () => {
    playingOnScreen = false;
    game.toIdle();
    showCard();
  });

  // -- headset -----------------------------------------------------------------

  const enterButton = $<HTMLButtonElement>('enter-vr');
  const status = $('xr-status');
  const STATUS: Record<Support, string> = {
    checking: 'VR keresése…',
    yes: 'A szemüvegben a jobb kezedben lesz a kard. Legyen körülötted egy karnyújtásnyi szabad hely!',
    no: 'Nem találok VR-szemüveget. Képernyőn egérrel vagy érintéssel is játszható.',
    none: 'Ez a böngésző nem ismeri a VR-t. Képernyőn egérrel vagy érintéssel is játszható.',
    blocked: 'A VR itt le van tiltva. Nyisd meg az oldalt közvetlenül a szemüveg böngészőjében.',
  };
  const setSupport = (support: Support) => {
    enterButton.disabled = support !== 'yes';
    status.textContent = STATUS[support];
  };
  if (!navigator.xr) setSupport('none');
  else {
    navigator.xr.isSessionSupported('immersive-vr').then(
      (ok) => setSupport(ok ? 'yes' : 'no'),
      (e) => setSupport((e as DOMException)?.name === 'SecurityError' ? 'blocked' : 'no'),
    );
  }

  enterButton.addEventListener('click', async () => {
    if (!navigator.xr || presenting) return;
    unlockAudio(); // still inside the click, which is what lets the page make sound later
    try {
      // "local-floor": the origin is on the real floor, so the top of the tower is where the child stands
      const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
      session.addEventListener('end', () => {
        presenting = false;
        playingOnScreen = false;
        game.setBlade(null);
        game.setMode('screen');
        game.toIdle();
        resize();
        showCard();
      });
      renderer.xr.setReferenceSpaceType('local-floor');
      // three.js asks for the strongest foveation by default, which blurs the top and bottom of the
      // view – right where the boxes come from; the whole picture stays sharp unless the settings say otherwise
      renderer.xr.setFoveation(FOVEATION_STEPS[foveation]);
      renderer.xr.setFramebufferScaleFactor(resolution);
      await renderer.xr.setSession(session);
      presenting = true;
      playingOnScreen = false;
      result.hidden = true;
      game.setMode('vr');
      game.toIdle();
      showCard();
    } catch (e) {
      status.textContent = `Nem sikerült belépni: ${(e as Error)?.message ?? e}`;
    }
  });

  // -- every frame -------------------------------------------------------------

  const head = new THREE.Vector3();
  const hilt = new THREE.Vector3();
  const tip = new THREE.Vector3();
  let last = 0;
  renderer.setAnimationLoop((now) => {
    const time = now / 1000;
    const dt = Math.min(0.05, Math.max(0, time - last));
    last = time;
    if (renderer.xr.isPresenting) {
      const eye = renderer.xr.getCamera().cameras[0];
      if (eye) head.setFromMatrixPosition(eye.matrixWorld);
      // a hand the headset does not see right now has no blade
      if (sword.group.parent?.visible) {
        sword.group.updateWorldMatrix(true, false);
        game.setBlade(hilt.copy(sword.hilt).applyMatrix4(sword.group.matrixWorld), tip.copy(sword.tip).applyMatrix4(sword.group.matrixWorld));
      } else game.setBlade(null);
    } else {
      head.copy(camera.position);
    }
    game.update(dt, time, head);
    renderer.render(scene, camera);
  });

  showCard();
  // for the smoke test, and for poking at the game from the console
  (window as unknown as Record<string, unknown>).__mathLord = { game, renderer, scene, camera };
}

try {
  boot();
} catch (e) {
  crash(String((e as Error)?.stack ?? e));
}
