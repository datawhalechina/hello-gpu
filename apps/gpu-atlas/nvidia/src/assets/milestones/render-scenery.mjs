// GPU ATLAS illustrative package, rendered locally. No chip architecture is implied.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage();
await page.goto('http://127.0.0.1:5173/src/data/generations.json');
const data=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js');
  const {RoundedBoxGeometry}=await import('/node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js');
  const renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
  renderer.setSize(2200,600);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  let seed=37224;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const studio=new T.Scene();studio.background=new T.Color('#10191d');
  const softbox=(position,scale,intensity,tint=[1,1,1])=>{const p=new T.Mesh(new T.PlaneGeometry(...scale),new T.MeshBasicMaterial({color:new T.Color().setRGB(...tint.map(c=>c*intensity)),side:T.DoubleSide,toneMapped:false}));p.position.set(...position);p.lookAt(0,0,0);studio.add(p);};
  softbox([0,10,-13],[7,13],3.2,[.94,.99,1]);softbox([-5,9,-4],[4,14],5.4,[.88,.96,1]);softbox([7,7,4],[1.2,16],4.6,[.90,1,.95]);softbox([-2,5,9],[10,2],2.4,[.86,.96,1]);softbox([0,-3,-8],[8,2],.5,[.7,.8,.8]);
  const pmrem=new T.PMREMGenerator(renderer),env=pmrem.fromScene(studio,.03);
  const scene=new T.Scene();scene.background=new T.Color('#091114');scene.environment=env.texture;scene.environmentIntensity=.73;
  scene.add(new T.HemisphereLight('#b2c1c4','#05090b',.26));
  const key=new T.DirectionalLight('#c8dedf',1.8);key.position.set(-4,10,3);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-12;key.shadow.camera.right=12;key.shadow.camera.top=12;key.shadow.camera.bottom=-12;key.shadow.normalBias=.03;key.shadow.bias=-.0001;scene.add(key);
  const rim=new T.DirectionalLight('#99beb7',1.2);rim.position.set(8,3,-5);scene.add(rim);
  const camera=new T.OrthographicCamera(-8.8,8.8,2.4,-2.4,.1,100);camera.position.set(0,10,13);camera.lookAt(0,0,0);
  const mat=(color,metalness=.7,roughness=.3,extra={})=>new T.MeshPhysicalMaterial({color,metalness,roughness,...extra});
  const graphite=mat('#1b2428',.75,.32),edge=mat('#677477',.96,.25),black=mat('#050a0d',.48,.39),pcb=mat('#0d1a1b',.35,.47),gold=mat('#707466',.87,.34),ceramic=mat('#192428',.58,.46),contact=mat('#86918d',.95,.32);
  const group=new T.Group();scene.add(group);group.position.set(3.80,0,.15);group.scale.setScalar(1.17);group.rotation.y=-.33;
  const box=(parent,w,h,d,material,x=0,y=0,z=0,r=.018)=>{const o=new T.Mesh(new RoundedBoxGeometry(w,h,d,3,r),material);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;};
  // Dense PCB traces are decorative routes, with exposed vias and small SMD components.
  const cv=document.createElement('canvas');cv.width=cv.height=2048;const ctx=cv.getContext('2d');ctx.fillStyle='#101b1e';ctx.fillRect(0,0,2048,2048);
  for(let i=0;i<5000;i++){const x=rand()*2048,y=rand()*2048;ctx.fillStyle=`rgba(90,109,109,${rand()*.05})`;ctx.fillRect(x,y,rand()*50,1);}
  for(let i=0;i<340;i++){const x=rand()*2048,y=rand()*2048,len=40+rand()*280,turn=15+rand()*50;ctx.strokeStyle= i%7===0?'#2c3838':'#1c2c2d';ctx.lineWidth=i%3===0?2:1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+len,y);ctx.lineTo(x+len+turn,y+turn);ctx.lineTo(x+len+turn+60,y+turn);ctx.stroke();ctx.fillStyle='#4c5450';ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#0b1517';ctx.beginPath();ctx.arc(x,y,1.2,0,Math.PI*2);ctx.fill();}
  const boardTex=new T.CanvasTexture(cv);boardTex.colorSpace=T.SRGBColorSpace;boardTex.anisotropy=16;
  box(group,23,.16,15,mat('#e1e4e2',.38,.56,{map:boardTex}),0,-.35,0,.06);
  for(let n=0;n<720;n++){const x=(rand()-.5)*21,z=(rand()-.5)*13;if(Math.abs(x)<3.65&&Math.abs(z)<3.04)continue;const vertical=rand()>.5;const w=vertical?.065:.15,d=vertical?.15:.065;box(group,w,.07,d,ceramic,x,-.22,z,.009);for(const s of [-1,1])box(group,vertical?w:w*.23,.078,vertical?d*.23:d,contact,x+(vertical?0:s*w*.4),-.222,z+(vertical?s*d*.4:0),.004);}
  for(let i=0;i<36;i++){const side=i%4,a=Math.floor(i/4),x=side===0?-4.2:side===1?4.2:(a-4)*1.03,z=side===2?-3.5:side===3?3.5:(a-4)*.72;box(group,.55,.085,.38,black,x,-.19,z,.022);for(let p=0;p<4;p++)for(const s of [-1,1])box(group,.033,.026,.065,contact,x-.18+p*.12,-.21,z+s*.22,.003);}
  // Ceramic substrate, a recessed carrier, then a bevelled brushed-metal heat spreader.
  box(group,6.95,.19,5.94,pcb,0,-.14,0,.065);
  box(group,6.7,.095,5.7,black,0,0,0,.06);
  box(group,6.30,.10,5.30,edge,0,.04,0,.12);
  box(group,6.24,.13,5.24,black,0,.13,0,.12);
  // Small exposed contacts along the carrier give the macro shot real scale.
  for(const s of [-1,1])for(let i=0;i<54;i++){const z=-2.66+i*.101;box(group,.065,.014,.033,gold,s*3.37,-.028,z,.0015);box(group,.033,.014,.06,gold,z*1.2,-.028,s*2.865,.0015);}
  for(const sx of [-1,1])for(const sz of [-1,1]){box(group,.29,.032,.24,contact,sx*3.04,.042,sz*2.51,.008);box(group,.21,.04,.16,ceramic,sx*3.04,.062,sz*2.51,.004);}
  const brush=document.createElement('canvas');brush.width=brush.height=2048;const bc=brush.getContext('2d');bc.fillStyle='#8a9498';bc.fillRect(0,0,2048,2048);
  for(let i=0;i<17000;i++){const y=rand()*2048,x=rand()*2048;bc.fillStyle=`rgba(${rand()>.5?'210,222,226':'12,18,22'},${.008+rand()*.13})`;bc.fillRect(x,y,18+rand()*370,.3+rand()*.7);}
  for(let i=0;i<12;i++){const gr=bc.createLinearGradient(0,0,2048,2048);gr.addColorStop(0,'transparent');gr.addColorStop(.15+i*.04,`rgba(140,154,158,.009)`);gr.addColorStop(1,'transparent');bc.fillStyle=gr;bc.fillRect(0,0,2048,2048);}
  const surfaceMap=new T.CanvasTexture(brush);surfaceMap.colorSpace=T.SRGBColorSpace;surfaceMap.anisotropy=16;
  const lidmat=mat('#849092',.88,.44,{map:surfaceMap,bumpMap:surfaceMap,bumpScale:.014,clearcoat:.16,clearcoatRoughness:.5});
  box(group,6.02,.21,5.02,lidmat,0,.215,0,.15);
  const ink=document.createElement('canvas');ink.width=ink.height=1536;const ic=ink.getContext('2d');ic.clearRect(0,0,1536,1536);ic.textAlign='center';ic.fillStyle='rgba(13,26,31,.75)';ic.font='42px Arial';ic.letterSpacing='11px';ic.fillText('GPU ATLAS',768,820);ic.fillStyle='rgba(16,29,34,.6)';ic.font='20px Arial';ic.letterSpacing='5px';ic.fillText('EXPLORE',768,895);ic.fillText('COMPUTING',768,924);ic.fillText('TOMORROW',768,953);
  ic.strokeStyle='rgba(137,153,156,.22)';ic.lineWidth=1;ic.beginPath();ic.moveTo(675,1004);ic.lineTo(861,1004);ic.stroke();
  const inkMap=new T.CanvasTexture(ink);inkMap.colorSpace=T.SRGBColorSpace;inkMap.anisotropy=16;
  const marking=new T.Mesh(new T.PlaneGeometry(5.8,4.8),new T.MeshStandardMaterial({map:inkMap,transparent:true,roughness:.85,metalness:.05,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));marking.rotation.x=-Math.PI/2;marking.position.y=.322;group.add(marking);
  box(group,1.26,.012,.90,black,1.95,.326,-1.76,.10);
  for(let j=0;j<6;j++)for(let i=0;i<9;i++)box(group,.033,.007,.018,graphite,1.52+i*.107,.339,-2.05+j*.109,.002);
  // Tight surrounding power components and fine alignment marks.
  for(const s of [-1,1])for(let i=0;i<18;i++){const z=-2.5+i*.29;box(group,.15,.077,.088,ceramic,s*3.58,-.178,z,.009);box(group,.03,.08,.088,contact,s*3.58-.067,-.177,z,.003);box(group,.03,.08,.088,contact,s*3.58+.067,-.177,z,.003);}
  renderer.render(scene,camera);
  const result=document.createElement('canvas');result.width=2200;result.height=600;const c=result.getContext('2d');c.drawImage(renderer.domElement,0,0);
  const fade=c.createLinearGradient(0,0,2200,0);fade.addColorStop(0,'rgba(9,17,20,1)');fade.addColorStop(.29,'rgba(9,17,20,.96)');fade.addColorStop(.45,'rgba(9,17,20,.70)');fade.addColorStop(.62,'rgba(9,17,20,.10)');fade.addColorStop(1,'rgba(9,17,20,.03)');c.fillStyle=fade;c.fillRect(0,0,2200,600);
  const vignette=c.createLinearGradient(0,0,0,600);vignette.addColorStop(0,'rgba(7,15,18,.12)');vignette.addColorStop(.6,'transparent');vignette.addColorStop(1,'rgba(6,13,15,.46)');c.fillStyle=vignette;c.fillRect(0,0,2200,600);
  return result.toDataURL('image/png').split(',')[1];
});
await writeFile(path.join(output,'library-chip-macro.png'),Buffer.from(data,'base64'));
await browser.close();
execFileSync('python3',['-c',`from PIL import Image
from pathlib import Path
import sys
p=Path(sys.argv[1])/'library-chip-macro.png'
Image.open(p).save(p.with_suffix('.webp'), quality=93, method=6)
p.unlink()
`,output]);
console.log('Rendered library-chip-macro.webp');
