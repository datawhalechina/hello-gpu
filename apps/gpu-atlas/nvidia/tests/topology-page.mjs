import {chromium, expect} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {ARCHITECTURE_FACTS} from '../src/data/architectureFacts.js';
const target=process.argv[2]||pathToFileURL(resolve('dist/index.html')).href;
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1366,height:1152},reducedMotion:'reduce',offline:target.startsWith('file:')});
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const chapter=async()=>page.evaluate(()=>{const e=document.querySelector('#architecture');window.scrollTo({top:scrollY+e.getBoundingClientRect().top-parseFloat(getComputedStyle(e).scrollMarginTop),behavior:'instant'})});
await mkdir('test-results',{recursive:true});
try{
const url=new URL(target);url.searchParams.set('architecture','blackwell');url.hash='architecture';await page.goto(url.href);await page.locator('.topology-diagram').waitFor();await chapter();
check('breadcrumb removed from topology page',await page.locator('#architecture > .architecture-breadcrumb').count()===0);
check('reference heading visible',await page.locator('#topology-title').isVisible());
check('shared generation rail is the only rail',await page.locator('.generation-rail:visible').count()===1);
for(const [id,facts] of Object.entries(ARCHITECTURE_FACTS)){
 await page.locator(`.site-generation-rail .generation-choice[data-generation="${id}"]`).click();await expect(page.locator('.topology-diagram')).toHaveAttribute('data-generation',id);await page.locator('#ap-tab-chip').click();
 const c=await page.locator('.topology-diagram').evaluate(e=>({clusters:e.querySelectorAll('.td-cluster').length,tiles:e.querySelectorAll('.td-sm-tile').length}));
 check(`${id}: full-chip cluster and SM counts`,c.clusters===facts.fullClusters&&c.tiles===facts.fullSm);
 await page.locator('#ap-tab-sm').click();const s=await page.locator('.topology-diagram').evaluate(e=>({cores:[...e.querySelectorAll('.td-core-value')].reduce((s,e)=>s+Number(e.textContent),0),tensor:!!e.querySelector('[data-part=tensor]'),rt:!!e.querySelector('[data-part=rt]')}));
 check(`${id}: SM execution resources and specialized units`,s.cores===facts.sm.cores&&s.tensor===!!facts.sm.tensor&&s.rt===!!facts.sm.rt);
}
await page.locator('#ap-tab-chip').click();await page.locator('.td-cluster').nth(1).click();await expect(page.locator('.ap-facts')).toContainText('GPC 02');check('cluster click synchronizes inspector',true);
await page.locator('.td-cluster').nth(1).dblclick();await expect(page.locator('.topology-diagram')).toHaveAttribute('data-view','sm');await page.locator('[data-part=tensor]').click();await expect(page.locator('.ap-selection')).toHaveText('TENSOR CORES');check('cluster drill and SM resource inspection',true);
await page.getByRole('button',{name:'返回整颗芯片',exact:true}).click();await expect(page.locator('.ap-facts')).toContainText('GPC 02');check('return preserves selected cluster',true);
await page.getByRole('button',{name:'隐藏拓扑标签',exact:true}).click();check('labels can be hidden without hiding controls',await page.locator('.td-cluster-name').first().evaluate(e=>getComputedStyle(e).opacity==='0')&&await page.locator('.td-cluster').first().getAttribute('aria-label'));
await page.getByRole('button',{name:'显示拓扑标签',exact:true}).click();await page.locator('.td-cache').focus();await page.keyboard.press('Enter');await expect(page.locator('.ap-facts')).toContainText('128 MB');await expect(page.locator('.ap-facts')).toContainText('96 MB');check('keyboard selection keeps full and product cache distinct',true);
await page.getByRole('button',{name:'放大芯片',exact:true}).click();await expect(page.locator('.ap-diagram-transform')).toHaveAttribute('data-zoom','115');
const canvas=page.locator('.ap-canvas');await canvas.focus();await page.keyboard.press('ArrowRight');check('zoom supports keyboard pan',await page.locator('.ap-diagram-transform').evaluate(e=>getComputedStyle(e).transform!=='matrix(1.15, 0, 0, 1.15, 0, 0)'));
const r=await canvas.boundingBox();await page.mouse.move(r.x+r.width*.6,r.y+r.height*.65);await page.mouse.down();await page.mouse.move(r.x+r.width*.6+30,r.y+r.height*.65+25,{steps:5});await page.mouse.up();check('zoomed canvas supports pointer pan',await page.locator('.ap-diagram-transform').evaluate(e=>!e.style.transform.includes('translate(0px,0px)')));
await page.getByRole('button',{name:'适合窗口',exact:true}).click();await expect(page.locator('.ap-diagram-transform')).toHaveAttribute('data-zoom','100');check('fit resets zoom and pan',await page.locator('.ap-diagram-transform').evaluate(e=>e.style.transform==='translate(0px, 0px) scale(1)'));
const expand=page.getByRole('button',{name:'全屏查看芯片',exact:true});await expand.click();await expect(page.locator('.ap-workspace')).toHaveAttribute('role','dialog');check('fullscreen is above fixed navigation',await page.evaluate(()=>!!document.elementFromPoint(500,30)?.closest('.ap-workspace.is-expanded')));
await page.keyboard.press('Shift+Tab');check('fullscreen traps focus inside workspace',await page.evaluate(()=>!!document.activeElement.closest('.ap-workspace.is-expanded')));await page.keyboard.press('Escape');check('Escape exits fullscreen and restores focus',await expand.evaluate(e=>document.activeElement===e)&&await page.evaluate(()=>document.body.style.overflow!=='hidden'));
await page.locator('#ap-tab-chip').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('#ap-tab-sm')).toHaveAttribute('aria-selected','true');check('view tabs support keyboard navigation',true);
await page.locator('#ap-tab-chip').click();
for(const width of [1920,1366,1024,768,390,320]){
 await page.setViewportSize({width,height:width<768?844:1152});await page.waitForTimeout(350);await chapter();await page.waitForTimeout(150);await chapter();
 check(`${width}px chapter is below sticky navigation`,await page.locator('#architecture').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=120&&r.top<180}));
 check(`${width}px no page overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 check(`${width}px heading and controls fit`,await page.locator('.ap-heading,.ap-zoom-controls,.ap-inspector').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)));
 check(`${width}px toolbar is below diagram`,await page.locator('.ap-view-footer').evaluate(e=>e.getBoundingClientRect().top>=document.querySelector('.ap-canvas').getBoundingClientRect().bottom-1));
 await page.screenshot({path:`test-results/topology-${width}.png`});
}
await page.setViewportSize({width:390,height:844});await chapter();await expand.click();check('mobile full screen keeps close control visible',await page.getByRole('button',{name:'退出芯片全屏',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.right<=innerWidth}));await page.keyboard.press('Escape');
await page.locator('.ap-resource-banner button').click();check('resource banner opens library',await page.locator('.sources-dialog[open]').isVisible());
check('no browser runtime errors',errors.length===0);
}finally{await writeFile('test-results/topology-page.json',JSON.stringify({target,checks,errors},null,2));console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,total:checks.length,errors}));await browser.close()}
