import {chromium} from '@playwright/test';
import {writeFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const target = process.argv[2] || pathToFileURL(resolve('dist/index.html')).href;
await mkdir('test-results', {recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1672,height:1000},reducedMotion:'reduce',offline:target.startsWith('file:')});
const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const check=(name,pass)=>{results.push({name,pass:!!pass});if(!pass)throw Error(name)};
const pause=()=>page.waitForTimeout(100);
const ready=async()=>{await page.locator('.micro-flat-canvas[data-ready=true][data-view=sm]').waitFor();await pause()};
async function reset(){await page.getByRole('button',{name:'适应视口',exact:true}).click();await pause();}
async function click(id,n=0){await reset();const r=await page.locator(`polygon[data-region="${id}"]`).nth(n).evaluate(el=>{const p=el.getAttribute('points').split(' ').map(t=>t.split(',').map(Number)),b=el.ownerSVGElement.getBoundingClientRect();return{x:b.left+p.reduce((s,v)=>s+v[0],0)/4,y:b.top+p.reduce((s,v)=>s+v[1],0)/4,...el.dataset}});await page.mouse.click(r.x,r.y);await pause();return r;}
async function matches(g,id,title,n=0){const r=await click(id,n);check(`${g}/${id}/${n}: actual click → ${title}`,await page.locator('.micro-explanation h3').innerText()===title);check(`${g}/${id}/${n}: main selection and inspector agree`,await page.locator('.micro-flat-canvas').getAttribute('data-selected-region-key')===r.regionKey&&await page.locator('.micro-explanation').getAttribute('data-region-key')===r.regionKey&&await page.locator(`polygon[data-region-key="${r.regionKey}"]`).getAttribute('class')==='focused');check(`${g}/${id}/${n}: exact printed region label`,await page.locator('.micro-selection-context code').innerText()===r.regionLabel);return r;}
const maps={tesla:{textureInterface:'纹理簇接口',cache:'独立共享存储',sfu:'特殊函数单元'},fermi:{textureCache:'纹理／Uniform 缓存',integer:'CUDA Core 内整数执行资源',cache:'L1／共享存储'},kepler:{textureUnits:'纹理单元与纹理缓存',cache:'L1／共享存储'},maxwell:{instructionBuffer:'指令缓冲区',textureL1:'纹理／L1 缓存',cache:'独立共享存储'},pascal:{instructionBuffer:'指令缓冲区',textureL1:'纹理／L1 缓存',cache:'独立共享存储'},volta:{l0InstructionCache:'L0 指令缓存',integer:'INT32 整数通路',textureUnits:'纹理单元'},turing:{l0InstructionCache:'L0 指令缓存',integer:'INT32 整数通路',textureUnits:'纹理单元'},ampere:{l0InstructionCache:'L0 指令缓存',integer:'INT32 整数通路',textureUnits:'纹理单元'},hopper:{l0InstructionCache:'L0 指令缓存',integer:'INT32 整数通路',textureUnits:'纹理单元'},ada:{l0InstructionCache:'L0 指令缓存',cuda:'FP32 执行通路',integer:'整数与浮点共用资源',textureUnits:'纹理单元'},blackwell:{l0InstructionCache:'L0 指令缓存',cuda:'FP32／INT32 统一通路',textureUnits:'纹理单元'}};
try{
await page.goto(target);await page.locator('[data-renderer=ready]').waitFor();await page.getByRole('button',{name:'SM 内部',exact:true}).click();await page.waitForTimeout(350);await page.getByRole('button',{name:'放大平铺',exact:true}).click();await ready();
for(const [g,extras] of Object.entries(maps)){
await page.getByRole('combobox',{name:'平铺视图架构'}).selectOption(g);await ready();const hide=page.getByRole('button',{name:'隐藏全部标签',exact:true});if(await hide.count())await hide.click();
await matches(g,'instructionCache','指令缓存');await matches(g,'scheduler','Warp 调度与派发');await matches(g,'registers','寄存器文件');
for(const [id,title] of Object.entries(extras))await matches(g,id,title);
check(`${g}: no legacy instruction alias`,await page.locator('polygon[data-region="instruction"]').count()===0);
if(['maxwell','pascal','volta','turing','ampere','hopper','ada','blackwell'].includes(g)){
 const r=await matches(g,'registers','寄存器文件',3);check(`${g}: selected register bank is 64 KB, total is 256 KB`,await page.locator('.micro-explanation-value').innerText()==='64 KB'&&(await page.locator('.micro-total-value').innerText()).includes('256 KB')&&(await page.locator('.micro-selection-context>span').innerText()).includes('分区 4'));
}
if(g==='blackwell')check('Blackwell: one unified FP32/INT32 resource category',await page.locator('polygon[data-region="integer"]').count()===0);
}
await page.getByRole('combobox',{name:'平铺视图架构'}).selectOption('volta');await ready();if(await page.getByRole('button',{name:'隐藏全部标签',exact:true}).count())await page.getByRole('button',{name:'隐藏全部标签',exact:true}).click();
for(let n=0;n<4;n++){await matches('volta','l0InstructionCache','L0 指令缓存',n);await matches('volta','scheduler','Warp 调度与派发',n);}
const picked=await matches('volta','l0InstructionCache','L0 指令缓存',2);
for(const operation of ['缩小平铺模型','放大平铺模型','适应视口','显示全部标签','隐藏全部标签']){await page.getByRole('button',{name:operation,exact:true}).click();await pause();check(`exact partition survives ${operation}`,await page.locator('.micro-flat-canvas').getAttribute('data-selected-region-key')===picked.regionKey&&await page.locator('.micro-explanation').getAttribute('data-region-key')===picked.regionKey)}
const stage=await page.locator('.micro-flat-canvas').boundingBox();await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height/2);await page.mouse.wheel(0,-120);await pause();await page.mouse.down();await page.mouse.move(stage.x+stage.width/2+40,stage.y+stage.height/2+20,{steps:4});await page.mouse.up();await pause();check('exact partition survives wheel and pan',await page.locator('.micro-flat-canvas').getAttribute('data-selected-region-key')===picked.regionKey);
await matches('volta','instructionCache','指令缓存');await page.screenshot({path:'test-results/GPU-Atlas-volta-instruction-cache.png'});
await matches('volta','l0InstructionCache','L0 指令缓存',2);await page.screenshot({path:'test-results/GPU-Atlas-volta-l0-cache.png'});
await matches('volta','registers','寄存器文件',2);await page.screenshot({path:'test-results/GPU-Atlas-volta-registers.png'});
await page.setViewportSize({width:390,height:844});await pause();await reset();await matches('volta-mobile','l0InstructionCache','L0 指令缓存',1);check('mobile context and totals stay inside viewport',await page.locator('.micro-explanation').evaluate(e=>e.scrollWidth<=e.clientWidth));await page.screenshot({path:'test-results/GPU-Atlas-volta-cache-mobile.png'});
check('removed magnifier and connector stay absent',await page.locator('.micro-detail-lens,.micro-lens-connector').count()===0);
check('no runtime or console errors',errors.length===0);
}finally{await writeFile('test-results/verification-sm-semantics.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({passed:results.filter(x=>x.pass).length,total:results.length,errors}));await browser.close();}
