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
  const risen = (what) => until(what, (s) => s.risen, 60000);
  /** Where the blade is relative to the controller when the controller is not turned at all (right hand). */
  let bladeAt = null;
  const park = (hand) =>
    page.evaluate((hand) => {
      const c = window.__xr.controllers[hand];
      c.position.set(hand === 'left' ? -0.2 : 0.2, 0.9, 0.5); // behind the player, away from every box
      c.quaternion.set(0, 0, 0, 1);
    }, hand);
  const measureBlade = async () => {
    await page.evaluate(() => {
      const c = window.__xr.controllers.right;
      c.position.set(0, 1, -0.3);
      c.quaternion.set(0, 0, 0, 1);
    });
    await frames(3);
    return page.evaluate(() => {
      const b = window.__mathLord.game.blade;
      // a point 60% along the blade, and which way the blade heads over the ground
      const mid = b.hilt.clone().lerp(b.tip, 0.6);
      return { x: mid.x, y: mid.y - 1, z: mid.z + 0.3, heading: Math.atan2(b.tip.x - b.hilt.x, -(b.tip.z - b.hilt.z)), rise: b.tip.y - b.hilt.y };
    });
  };
  /** An upward slash with the given hand through the box in `slot`. */
  const slash = async (hand, slot) => {
    // the left hand holds the sword mirrored
    const m = hand === 'left' ? { ...bladeAt, x: -bladeAt.x, heading: -bladeAt.heading } : bladeAt;
    // step -8 comes in from the middle of the tower, below the box; then the blade goes up through it
    for (let step = -8; step <= 2; step++) {
      const going = await page.evaluate(
        ({ hand, slot, step, m }) => {
          const game = window.__mathLord.game.snapshot();
          const c = game.crates[slot];
          if (game.state !== 'playing' || c.phase !== 'rise') return false; // cut: stop there
          // turn the hand so that the blade heads for the box, and hold it so that the blade's middle is in the box
          const angle = Math.atan2(c.x, -c.z);
          const turn = m.heading - angle;
          const cos = Math.cos(turn);
          const sin = Math.sin(turn);
          const back = step === -8 ? 0.6 : 0;
          const controller = window.__xr.controllers[hand];
          controller.position.set(
            c.x - (m.x * cos + m.z * sin) - back * Math.sin(angle),
            c.y - m.y + Math.max(step, -7) * 0.1,
            c.z - (-m.x * sin + m.z * cos) + back * Math.cos(angle),
          );
          controller.quaternion.set(0, Math.sin(turn / 2), 0, Math.cos(turn / 2));
          return true;
        },
        { hand, slot, step, m },
      );
      if (!going) break;
      await frames(1);
    }
    await park(hand);
  };

  check('VR is offered', await page.isEnabled('#enter-vr'));
  await page.click('#enter-vr');
  await page.waitForTimeout(1500);
  check('session runs', await page.evaluate(() => window.__mathLord.renderer.xr.isPresenting));
  check('title is shown first', (await snap()).state === 'idle');
  bladeAt = await measureBlade();
  await park('right');
  await park('left');

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
    if (mistake === 1) {
      // the horizon tips and comes back
      let most = 0;
      for (let i = 0; i < 400 && (await snap()).state === 'resolving'; i++) {
        most = Math.max(most, (await snap()).lean);
        await page.waitForTimeout(20);
      }
      check('the tower leans on a mistake', most > 2, `up to ${most.toFixed(1)}°`);
      check('…and stands straight again', (await snap()).lean === 0);
    }
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
  check('the blade follows the handle, well above the pointing ray', bladeAt.rise > 0.5, `rises ${bladeAt.rise.toFixed(2)} m over its 0.85 m`);

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
