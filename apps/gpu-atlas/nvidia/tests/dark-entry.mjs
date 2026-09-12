import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const target = process.argv[2] || pathToFileURL(resolve('dist/index.html')).href;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1672, height: 1000 }, reducedMotion: 'no-preference', offline: target.startsWith('file:') });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const checks = [];
const check = (name, pass) => checks.push({ name, pass: !!pass });
try {
  await page.goto(target);
  await page.locator('[data-renderer=ready]').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'SM 内部', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '放大平铺', exact: true }).click();
  await page.waitForTimeout(1600);
  const state = await page.evaluate(() => {
    const workbench = document.querySelector('.micro-workbench');
    const body = document.querySelector('.micro-workbench-body');
    const inspector = document.querySelector('.micro-inspector');
    const transition = document.querySelector('.cinema-workbench-transition');
    const scene = document.querySelector('.cinematic-webgl');
    const wb = workbench && getComputedStyle(workbench);
    const bd = body && getComputedStyle(body);
    const card = inspector && getComputedStyle(inspector);
    const handoff = transition && getComputedStyle(transition);
    return {
      open: !!workbench?.open,
      workbenchBackground: wb?.backgroundColor,
      workbenchColorScheme: wb?.colorScheme,
      bodyGradient: bd?.backgroundImage,
      inspectorBackground: card?.backgroundColor,
      handoffAnimation: handoff?.animationName,
      sceneTransition: scene?.getAttribute('data-transition')
    };
  });
  check('workbench opens after the handoff', state.open);
  check('workbench stays dark', /rgb\(8, 13, 18\)|rgb\(10, 17, 23\)|rgb\(9, 14, 20\)/.test(state.workbenchBackground || ''));
  check('workbench declares dark color scheme', state.workbenchColorScheme === 'dark');
  check('canvas keeps dark gradient', /rgb\(8, 13, 18\)/.test(state.bodyGradient || ''));
  check('inspector is a dark glass card', /rgba\(17, 26, 34/.test(state.inspectorBackground || ''));
  check('handoff uses dark crossfade', state.handoffAnimation === 'cinema-enter-dark');
  check('scene camera remains in stage orientation', state.sceneTransition === 'stage');
  const zoomButton = await page.locator('.micro-zoom button[aria-label="适应视口"]').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, zIndex: getComputedStyle(el).zIndex }));
  check('fit button has an opaque foreground layer', zoomButton.background === 'rgb(17, 28, 37)' && zoomButton.zIndex === '1');
  await page.getByRole('button', { name: '返回三维', exact: true }).click();
  await page.waitForTimeout(360);
  const returning = await page.evaluate(() => {
    const pin = document.querySelector('.cinema-pin');
    const transition = document.querySelector('.cinema-workbench-transition');
    return { className: pin?.className || '', animation: transition && getComputedStyle(transition).animationName, workbench: !!document.querySelector('.micro-workbench') };
  });
  check('return to 3D starts a reverse dark transition', returning.className.includes('is-returning-workbench') && returning.animation === 'cinema-exit-dark' && !returning.workbench);
  await page.waitForTimeout(500);
  check('return transition releases cleanly', await page.evaluate(() => !document.querySelector('.cinema-pin')?.className.includes('is-returning-workbench')));
  check('no runtime or console errors', errors.length === 0);
  console.log(JSON.stringify({ passed: checks.filter(c => c.pass).length, total: checks.length, checks, errors, state }));
  if (checks.some(c => !c.pass)) process.exitCode = 1;
} finally {
  await browser.close();
}
