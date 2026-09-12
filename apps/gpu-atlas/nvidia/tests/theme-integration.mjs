import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const target = process.argv[2] || 'http://127.0.0.1:5193/';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light' });
const page = await context.newPage();
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const check = (name, pass) => { checks.push({ name, pass: !!pass }); if (!pass) throw new Error(name); };
const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
const ready = () => page.locator('.atlas-theme-toggle').waitFor();
try {
  await page.goto(target); await ready();
  check('first visit defaults to dark even when system is light', await theme() === 'dark');
  check('document title identifies NVIDIA and tutorial', await page.title() === 'NVIDIA GPU 图谱 | Hello GPU');
  const links = await page.locator('.brand,.tutorial-return').evaluateAll(elements => elements.map(el => el.href));
  check('portal and tutorial return links resolve against deployment base', links[0] === new URL('../', target).href && links[1] === new URL('../../', target).href);
  await page.getByRole('button', { name: '切换到日间模式', exact: true }).click();
  check('theme switch persists the tutorial preference', await page.evaluate(() => localStorage.getItem('vitepress-theme-appearance')) === 'light');
  await page.reload(); await ready();
  check('saved light preference survives reload', await theme() === 'light');
  check('light theme applies before React mounts', await page.evaluate(() => document.documentElement.style.backgroundColor === 'rgb(255, 255, 255)' && document.documentElement.style.colorScheme === 'light'));
  for (const selector of ['body', '.cinematic-story', '.cinema-pin', '.archive-landing', '.topology-page', '.performance-page', '.performance-footer']) {
    check(`${selector} has a white day surface`, await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(255, 255, 255)');
  }
  const peer = await context.newPage();
  await peer.goto(new URL('?architecture=tesla', target).href); await peer.locator('.atlas-theme-toggle').waitFor();
  await peer.getByRole('button', { name: '切换到深色模式', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  check('theme changes propagate from another tab', await theme() === 'dark');
  await peer.evaluate(() => localStorage.setItem('vitepress-theme-appearance', 'auto'));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  check('auto preference follows system changes', await theme() === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  check('auto preference remains auto', await page.evaluate(() => localStorage.getItem('vitepress-theme-appearance')) === 'auto');
  await peer.close();

  const deep = new URL(target); deep.searchParams.set('architecture', 'hopper'); deep.hash = 'architecture';
  await page.goto(deep.href); await ready();
  await page.locator('.site-generation-rail [data-generation=hopper][aria-selected=true]').waitFor();
  check('architecture query selects requested generation', await page.locator('.cinematic-story').getAttribute('data-generation') === 'hopper');
  await page.waitForFunction(() => document.getElementById('architecture').getBoundingClientRect().top < 200);
  check('hash link positions section below the fixed navigation', await page.locator('#architecture').evaluate(el => Math.abs(el.getBoundingClientRect().top - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--atlas-nav-height'))) < 15));
  await page.locator('.site-generation-rail [data-generation=hopper]').press('ArrowRight');
  check('keyboard architecture navigation updates shareable URL', new URL(page.url()).searchParams.get('architecture') === 'ada');

  for (const width of [320, 390, 768, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(`${width}px page does not overflow horizontally`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`${width}px header links and theme button remain inside viewport`, await page.locator('.header .brand,.header .tutorial-return,.header .library-button,.header .atlas-theme-toggle').evaluateAll(elements => elements.every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.locator('[data-renderer=ready]').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'SM 内部', exact: true }).click();
  await page.getByRole('button', { name: '放大平铺', exact: true }).click();
  await page.locator('.micro-workbench[open]').waitFor();
  check('light workbench opens with white background', await page.locator('.micro-workbench').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(255, 255, 255)');
  check('workbench reduced motion is honored', await page.locator('.micro-workbench').evaluate(el => parseFloat(getComputedStyle(el).animationDuration) <= .01));
  await page.getByRole('button', { name: '返回三维', exact: true }).click();
  await page.getByRole('button', { name: '资料库', exact: false }).first().click();
  await page.locator('.sources-dialog[open]').waitFor();
  check('reference library remains accessible and sourced', (await page.locator('.sources-dialog a[href^="https://"]').count()) > 10);
  await page.keyboard.press('Escape');
  check('reference library closes with Escape', await page.locator('.sources-dialog').count() === 0);
  check('no runtime errors', errors.length === 0);
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/theme-integration.json', JSON.stringify({ target, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.filter(check => check.pass).length, total: checks.length, checks, errors }));
  await browser.close();
}
