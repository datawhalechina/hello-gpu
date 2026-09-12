import { chromium, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const target = process.argv[2] || pathToFileURL(resolve('dist/index.html')).href;
const url = new URL(target); url.searchParams.set('architecture', 'blackwell'); url.hash = 'milestones';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1366, height: 1240 }, reducedMotion: 'reduce', offline: target.startsWith('file:') });
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const check = (name, pass) => { checks.push({ name, pass: !!pass }); if (!pass) throw Error(name); };
const reveal = () => page.locator('#milestones').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
await mkdir('test-results', { recursive: true });
try {
  await page.goto(url.href); await page.locator('.mc-event').first().waitFor(); await page.waitForTimeout(350);
  check('direct chapter link opens below the shared navigation', await page.locator('#milestones').evaluate(el => el.getBoundingClientRect().top >= 155 && el.getBoundingClientRect().top < 185));
  check('performance stays selected with one shared generation rail', await page.locator('nav [href="#performance"]').getAttribute('aria-current') === 'location' && await page.locator('.generation-rail:visible').count() === 1);
  check('all three historical transitions and years are present', (await page.locator('.mc-year').allTextContents()).join(',') === '2006,2017,2018' && await page.locator('.mc-event').count() === 3);
  check('capability chips and period statistics are complete', await page.locator('.mc-tags span').count() === 9 && (await page.locator('.mc-stats dd').allTextContents()).join(',') === '3,19');
  check('macro artwork loads offline without another WebGL canvas', await page.locator('.mc-resource-image').evaluate(el => el.complete && el.naturalWidth === 2200) && await page.locator('#milestones canvas').count() === 0);
  for (const width of [1920, 1366, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1240 }); await page.waitForTimeout(300); await reveal();
    check(`${width}px no horizontal page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`${width}px text and capability chips fit their containers`, await page.locator('.mc-introduction h2,.mc-lead,.mc-stats,.mc-event-heading,.mc-event>p,.mc-tags,.mc-resource h3,.mc-resource p').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1)));
    check(`${width}px cards and resource action remain in bounds`, await page.locator('.mc-event,.mc-resource button').evaluateAll(els => els.every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height >= 44; })));
    check(`${width}px timeline connects the centers of successive nodes`, await page.locator('.mc-stop').evaluateAll(els => els.slice(0, -1).every((el, i) => { const style = getComputedStyle(el, ':before'); const a = el.getBoundingClientRect(); const next = els[i + 1].querySelector('.mc-node').getBoundingClientRect(); return Math.abs(a.top + parseFloat(style.top) + parseFloat(style.height) - (next.top + next.height / 2)) < 2; })));
    await page.screenshot({ path: `test-results/milestones-${width}.png` });
    if (width === 390) await page.locator('#milestones').screenshot({ path: 'test-results/milestones-mobile-section.png' });
  }
  for (const selector of ['.mc-source-link', '.mc-resource button']) {
    await page.locator(selector).click(); await expect(page.locator('.sources-dialog[open]')).toBeVisible();
    check(`${selector}: opens official reference library`, await page.locator('#sources-title').isVisible());
    await page.getByRole('button', { name: '关闭资料库' }).click();
    check(`${selector}: restores keyboard focus`, await page.locator(selector).evaluate(el => el === document.activeElement));
  }
  await page.setViewportSize({ width: 1366, height: 1240 }); await page.waitForTimeout(300);
  for (const [index, id, name] of [[0, 'tesla', '统一着色'], [1, 'volta', '矩阵计算'], [2, 'turing', '实时光追']]) {
    await reveal(); const card = page.locator('.mc-event').nth(index);
    if (index === 1) { await card.focus(); await page.keyboard.press('Enter'); } else await card.click();
    await expect(page.locator(`.site-generation-rail [data-generation="${id}"]`)).toHaveAttribute('aria-selected', 'true');
    check(`${name}: opens the matching architecture by ${index === 1 ? 'keyboard' : 'click'}`, new URL(page.url()).hash === '#archive' && new URL(page.url()).searchParams.get('architecture') === id);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto(url.href); await page.waitForTimeout(1100);
  await expect(page.locator('.mc-event').first()).toHaveCSS('opacity', '1');
  check('scroll reveal settles into a fully visible stable card', await page.locator('.mc-event').evaluateAll(els => els.every(el => getComputedStyle(el).opacity === '1' && ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(el).transform))));
  check('no browser runtime errors', errors.length === 0);
} finally {
  await writeFile('test-results/milestones-page.json', JSON.stringify({ target, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.filter(c => c.pass).length, total: checks.length, errors }));
  await browser.close();
}
