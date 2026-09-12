import {chromium,expect} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import generations from '../src/data/generations.json' with {type:'json'};
const target=process.argv[2]||pathToFileURL(resolve('dist/index.html')).href;
const b=await chromium.launch({headless:true,channel:'chrome'});
const p=await b.newPage({viewport:{width:1366,height:1152},reducedMotion:'reduce',offline:target.startsWith('file:')});
const checks=[],errors=[];p.on('pageerror',e=>errors.push(e.message));
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const reveal=()=>p.locator('#performance').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));
await mkdir('test-results',{recursive:true});
try{
 const url=new URL(target);url.searchParams.set('architecture','blackwell');url.hash='performance';await p.goto(url.href);await p.locator('.pt-plot').waitFor();await p.waitForTimeout(300);await reveal();
 check('single full-size performance chart',await p.locator('.pt-plot').count()===1&&await p.locator('.chart-aside').count()===0);
 check('default active navigation and shared rail',await p.locator('nav [href="#performance"]').getAttribute('aria-current')==='location'&&await p.locator('.generation-rail:visible').count()===1);
 check('all eleven architectures plotted',await p.locator('.pt-node').count()===11);
 const y=await p.locator('.pt-node').evaluateAll(es=>Object.fromEntries(es.map(e=>[e.dataset.generation,Number(e.querySelector('.pt-node-inner')?.getAttribute('cy'))])));
 check('transistor curve preserves actual decreases',y.volta<y.turing&&y.hopper<y.ada);
 const format=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(v);
 for(const g of generations){
  await p.locator(`.pt-node[data-generation="${g.id}"]`).click();await expect(p.locator('.pf-product')).toHaveAttribute('data-generation',g.id);await expect(p.locator('.pf-product-value strong')).toHaveText(`${format(g.transistors)}B`);
  check(`${g.id}: chart click selects matching card, URL and rail`,new URL(p.url()).searchParams.get('architecture')===g.id&&new URL(p.url()).hash==='#performance'&&await p.locator(`.site-generation-rail [data-generation="${g.id}"]`).getAttribute('aria-selected')==='true');
  const art=p.locator('.pf-product-art img');await expect(art).toHaveAttribute('alt',new RegExp(g.card.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));await expect(art).toBeVisible();check(`${g.id}: correct product image loads`,await art.evaluate(e=>e.complete&&e.naturalWidth>0));
 }
 await p.locator('.pt-node[data-generation="volta"]').focus();await p.keyboard.press('Enter');await expect(p.locator('.pf-product')).toHaveAttribute('data-generation','volta');check('keyboard selects graph node',true);
 await p.locator('.pt-node[data-generation="ampere"]').hover();await expect(p.locator('.pt-tooltip')).toContainText('Ampere');check('hover previews without changing chosen product',await p.locator('.pf-product').getAttribute('data-generation')==='volta');
 await p.locator('#performance-title').hover();await p.locator('.pt-metrics').getByRole('tab',{name:'显存带宽'}).click();await expect(p.locator('.pf-product-value strong')).toHaveText('900');check('bandwidth tab updates graph and product value',await p.locator('.pt-node[data-generation="blackwell"]').getAttribute('data-value')==='1792');
 await p.locator('.pt-metrics').getByRole('tab',{name:'FP32 算力'}).click();await expect(p.locator('.pf-product-value strong')).toHaveText('14');check('FP32 missing datum is not plotted as zero',await p.locator('.pt-node[data-generation="tesla"] .pt-node-inner').count()===0&&await p.locator('.pt-node[data-generation="tesla"] .pt-missing-symbol').count()===1);
 await p.locator('.pt-node[data-generation="tesla"]').click();await expect(p.locator('.pf-product-value')).toContainText('暂无同口径数据');check('missing value has explicit description',await p.locator('.pt-tooltip').innerText().catch(()=>p.locator('.pt-tooltip').textContent()));
 await p.getByRole('combobox',{name:'筛选 GPU 类型'}).selectOption('数据中心');check('datacenter filter retains three valid products',await p.locator('.pt-node').count()===3);await p.getByRole('combobox',{name:'筛选 GPU 类型'}).selectOption('消费级');check('consumer filter retains eight products',await p.locator('.pt-node').count()===8);await p.getByRole('combobox',{name:'筛选 GPU 类型'}).selectOption('all');
 await p.locator('.pt-metrics').getByRole('tab',{name:'晶体管规模'}).click();await p.locator('.site-generation-rail [data-generation="blackwell"]').click();await p.locator('#performance-title').hover();await reveal();
 for(const width of [1920,1366,1024,768,390,320]){
  await p.setViewportSize({width,height:width<768?844:1152});await p.waitForTimeout(350);await reveal();
  check(`${width}px no horizontal page overflow`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(`${width}px title and product stats remain readable`,await p.locator('.pf-copy h2,.pf-product-stats,.pf-product-top,.pt-header').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)));
  check(`${width}px chart stays below sticky navigation`,await p.locator('#performance').evaluate(e=>e.getBoundingClientRect().top>=120&&e.getBoundingClientRect().top<180));
  await p.screenshot({path:`test-results/performance-${width}.png`});
 }
 for(const g of generations){await p.locator(`.site-generation-rail [data-generation="${g.id}"]`).click();await expect(p.locator('.pf-product')).toHaveAttribute('data-generation',g.id);check(`${g.id}: 320px product text and process fit`,await p.locator('.pf-product h3,.pf-product-stats,.pf-product-top').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)))}
 await p.setViewportSize({width:1366,height:1152});await p.waitForTimeout(300);await reveal();await p.locator('.pt-source button').click();check('chart data source opens library',await p.locator('.sources-dialog[open]').isVisible());await p.getByRole('button',{name:'关闭资料库'}).click();
 for(const [id,name] of [['tesla','统一着色'],['volta','矩阵计算'],['turing','实时光追']]){await p.locator(`.mc-event`).filter({hasText:name}).click();await expect(p.locator('.archive-landing')).toContainText(generations.find(g=>g.id===id).chip);check(`${name}: opens corresponding architecture archive`,new URL(p.url()).hash==='#archive'&&new URL(p.url()).searchParams.get('architecture')===id);await p.locator('nav [href="#performance"]').click();await reveal()}
 check('no runtime errors',errors.length===0);
}finally{await writeFile('test-results/performance-page.json',JSON.stringify({target,checks,errors},null,2));console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,total:checks.length,errors}));await b.close()}
