// Plays the built page (dist-single.html) in a headless browser with an emulated Quest 3 (iwer):
// enters VR, starts with the trigger, cuts the right box, then makes three mistakes and restarts.
// Needs a Playwright that brings its own Chromium:  npm run build:single && npm run smoke
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const shots = process.env.SHOTS || '';
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` – ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript({ path: path.join(root, 'node_modules/iwer/build/iwer.min.js') });
  await page.addInitScript(() => {
    const device = new IWER.XRDevice(IWER.metaQuest3);
    device.installRuntime({ forceInstall: true });
    device.position.set(0, 1.3, 0);
    window.__xr = device;
  });
  await page.goto(`file://${path.join(root, 'dist-single.html')}`);
  await page.waitForTimeout(1500);

  const snap = () => page.evaluate(() => window.__mathLord.game.snapshot());
  const until = async (what, test, ms = 20000) => {
    const end = Date.now() + ms;
    let s = await snap();
    while (!test(s) && Date.now() < end) {
      await page.waitForTimeout(100);
      s = await snap();
    }
    check(what, test(s), `state ${s.state}, score ${s.score}, lives ${s.lives}`);
    return s;
  };
  /** Wait until the game has drawn this many more frames (a software renderer is slow and uneven). */
  const frames = async (count) => {
    const from = (await snap()).frame;
    while ((await snap()).frame < from + count) await page.waitForTimeout(20);
  };
  const trigger = async (hand) => {
    await page.evaluate((hand) => window.__xr.controllers[hand].updateButtonValue('trigger', 1), hand);
    await frames(3);
    await page.evaluate((hand) => window.__xr.controllers[hand].updateButtonValue('trigger', 0), hand);
    await frames(3);
  };
  /** A problem is up and its boxes have finished shooting up. */
  const risen = (what) => until(what, (s) => s.state === 'playing' && s.waveTime > 1.3, 60000);
  /** An upward slash with the given hand through the box in `slot`. */
  const slash = async (hand, slot) => {
    for (let step = -6; step <= 2; step++) {
      await page.evaluate(
        ({ hand, slot, step }) => {
          const c = window.__mathLord.game.snapshot().crates[slot];
          const angle = Math.atan2(c.x, -c.z);
          const controller = window.__xr.controllers[hand];
          // the hand half a metre out towards the box; the blade leans up 22° and reaches the box 0.26 m higher
          controller.position.set(Math.sin(angle) * 0.5, c.y - 0.26 + step * 0.1, -Math.cos(angle) * 0.5);
          controller.quaternion.set(0, Math.sin(-angle / 2), 0, Math.cos(-angle / 2));
        },
        { hand, slot, step },
      );
      await frames(1);
    }
  };

  check('VR is offered', await page.isEnabled('#enter-vr'));
  await page.click('#enter-vr');
  await page.waitForTimeout(1500);
  check('session runs', await page.evaluate(() => window.__mathLord.renderer.xr.isPresenting));
  check('title is shown first', (await snap()).state === 'idle');

  await trigger('right');
  let s = await until('right trigger starts the game', (s) => s.state === 'playing');
  s = await risen('the boxes come up');
  if (shots) await page.screenshot({ path: path.join(shots, 'vr-playing.png') });

  await slash('right', s.correct);
  s = await until('cutting the right box scores', (s) => s.score === 1);
  check('…and costs no life', s.lives === 3);

  for (let mistake = 1; mistake <= 3; mistake++) {
    s = await risen(`problem before mistake ${mistake}`);
    // the second mistake is made with the left hand, after taking the sword over with its trigger
    const hand = mistake === 2 ? 'left' : 'right';
    if (mistake === 2) await trigger('left');
    if (mistake === 3) await trigger('right');
    await slash(hand, (s.correct + 2) % 5);
    s = await until(`mistake ${mistake} costs a life (${hand} hand)`, (s) => s.lives === 3 - mistake);
    if (shots && mistake === 1) {
      await frames(8);
      await page.screenshot({ path: path.join(shots, 'vr-mistake.png') });
    }
  }
  s = await until('the tower comes down', (s) => s.state === 'falling', 60000);
  await frames(30);
  check('the player falls (the world rushes up)', (await snap()).worldY > 0.5);
  if (shots) await page.screenshot({ path: path.join(shots, 'vr-falling.png') });
  s = await until('game over', (s) => s.state === 'over', 60000);
  check('the world is back in place', s.worldY === 0);
  await frames(25);
  if (shots) await page.screenshot({ path: path.join(shots, 'vr-over.png') });
  await trigger('right');
  s = await until('trigger starts a new game', (s) => s.state === 'playing' && s.score === 0 && s.lives === 3);

  // letting the boxes fly away is a mistake too
  s = await until('boxes that fly away cost a life', (s) => s.lives === 2, 240000);

  await page.evaluate(() => window.__mathLord.renderer.xr.getSession().end());
  await page.waitForTimeout(1500);
  check('leaving VR returns to the title', (await snap()).state === 'idle' && (await page.isVisible('#card')));
  check('no errors on the page', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(failed ? `${failed} check(s) failed` : 'all good');
  process.exit(failed ? 1 : 0);
})();
