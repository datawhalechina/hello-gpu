// Regenerates the transparent thumbnail assets from the same PCIe models used
// by the immersive explorer. Run with the local Vite server on port 5173.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 720, height: 480 } });
await page.goto('http://127.0.0.1:5173/src/data/generations.json');
const rendered = await page.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const { createGenerationHardware } = await import('/src/components/cinematic/generationHardware.js');
  const { createHardwareModel } = await import('/src/components/cinematic/hardwareModel.js');
  const { RoundedBoxGeometry } = await import('/node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js');
  const generations = await (await fetch('/src/data/generations.json')).json();
  document.body.innerHTML = '';
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(720, 480);renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  document.body.append(renderer.domElement);
  const studio = new THREE.Scene();studio.background = new THREE.Color('#141c21');
  function softbox(position, scale, intensity, tint = [1,1,1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(...scale),new THREE.MeshBasicMaterial({color: new THREE.Color().setRGB(...tint.map(c=>c*intensity)),side:THREE.DoubleSide,toneMapped:false}));
    p.position.set(...position);p.lookAt(0,0,0);studio.add(p);
  }
  softbox([-4,7,4],[3.5,9],5.5,[.95,.98,1]);softbox([6,3,-3],[1.8,10],7,[1,.99,.97]);
  softbox([-6,-2,-4],[2,6],1.6,[.76,.84,.86]);softbox([0,-7,3],[7,1.4],2.5,[.95,1,.97]);
  softbox([-5,7,-9],[9,4],4.5,[.96,.98,1]);softbox([-5,-3,9],[10,4],2.3,[.94,.97,1]);
  const generator = new THREE.PMREMGenerator(renderer), environment = generator.fromScene(studio,.02);
  const scene = new THREE.Scene();scene.environment=environment.texture;scene.environmentIntensity=.83;
  for(const [color,intensity,position] of [[0xf2f5ff,1.25,[-3,8,6]],[0xe6edee,2.1,[7,4,-5]],[0x91a7a5,.52,[-8,1,-2]],[0xc8d7cf,.22,[3,-1,-7]]]){
    const l=new THREE.DirectionalLight(color,intensity);l.position.set(...position);scene.add(l);
  }
  scene.add(new THREE.HemisphereLight(0xc2d0d7,0x070909,.16));
  const camera=new THREE.OrthographicCamera(-5.4,5.4,3.6,-3.6,.1,100);
  camera.position.set(.7,9,13);camera.up.set(.33,.94,0);camera.lookAt(0,0,0);
  const assets={};
  for(const generation of generations){
    const model=generation.id==='blackwell'?createHardwareModel():createGenerationHardware(generation);
    if(generation.id==='blackwell'){model.root.rotation.x=Math.PI-.13;model.board.position.y=.24;model.ioBracket.position.y=.24;}
    scene.add(model.root);renderer.render(scene,camera);
    assets[generation.id]=renderer.domElement.toDataURL('image/png').split(',')[1];
    scene.remove(model.root);model.dispose();
  }
  const mat = (color, metalness=.8, roughness=.29, extra={})=>new THREE.MeshPhysicalMaterial({color,metalness,roughness,...extra});
  const dark=mat('#1c2b30',.82,.28), edge=mat('#526c70',.92,.25), glass=mat('#344d52',.3,.16,{transparent:true,opacity:.64,clearcoat:1}), tile=mat('#3c5357',.8,.27), bright=mat('#a3c7b9',.8,.15), black=mat('#0e181b',.6,.4);
  const box=(g,w,h,d,m,x=0,y=0,z=0,r=.012)=>{const o=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,2,r),m);o.position.set(x,y,z);g.add(o);return o;};
  const wire=(g,geometry,color,opacity=1)=>{const o=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color,transparent:true,opacity}));g.add(o);return o;};
  renderer.setSize(600,320);camera.left=-3.45;camera.right=3.45;camera.top=1.84;camera.bottom=-1.84;camera.position.set(5,4,7);camera.up.set(0,1,0);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
  for(const kind of ['tesla','volta','turing']){
    const root=new THREE.Group();scene.add(root);
    if(kind==='tesla'){
      for(let y=0;y<3;y++)for(let z=0;z<3;z++)for(let x=0;x<3;x++){
        const o=box(root,.68,.68,.68,glass,(x-1)*.72,(y-1)*.72,(z-1)*.72,.018);
        const line=wire(root,o.geometry,0x9ab9b6,.46);line.position.copy(o.position);
        if(y===0&&x===1&&z===2)box(root,.6,.05,.6,bright,(x-1)*.72,(y-1)*.72+.3,(z-1)*.72,.009);
      }
      root.rotation.y=-.17;
    }else if(kind==='volta'){
      box(root,3.65,.12,2.6,black,0,-.22,0,.05);box(root,3.5,.035,2.45,edge,0,-.15,0,.02);
      for(let z=0;z<4;z++)for(let x=0;x<6;x++){
        const px=(x-2.5)*.54,pz=(z-1.5)*.55;
        box(root,.45,.19,.45,dark,px,.005,pz,.024);box(root,.39,.015,.39,tile,px,.11,pz,.018);
        const line=wire(root,new THREE.BoxGeometry(.35,.01,.35),0x95b9b7,.5);line.position.set(px,.126,pz);
        for(const sx of [-1,1])for(let i=0;i<3;i++)box(root,.04,.019,.012,edge,px+sx*.25,.025,pz-.12+i*.12,.002);
      }
      root.rotation.y=-.4;camera.position.set(4,6.5,7);camera.lookAt(0,0,0);
    }else{
      camera.position.set(4,3,8);camera.lookAt(0,0,0);
      const sphere=new THREE.Mesh(new THREE.SphereGeometry(.57,64,48),mat('#82999b',1,.14));sphere.position.set(-.85,.15,.3);root.add(sphere);
      const triangle=new THREE.Shape();triangle.moveTo(-.55,-.95);triangle.lineTo(1.45,-.95);triangle.lineTo(1.45,1.3);triangle.closePath();
      const pane=new THREE.Mesh(new THREE.ShapeGeometry(triangle),mat('#23373d',.28,.1,{transparent:true,opacity:.4,side:THREE.DoubleSide}));pane.position.z=-.35;root.add(pane);
      const points=[new THREE.Vector3(-.55,-.95,-.35),new THREE.Vector3(1.45,-.95,-.35),new THREE.Vector3(1.45,1.3,-.35),new THREE.Vector3(-.55,-.95,-.35)];
      root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x8badaa})));
      const ray=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.6,-.2,.25),new THREE.Vector3(-.85,.15,.3),new THREE.Vector3(1.45,1.3,-.35)]),new THREE.LineBasicMaterial({color:0xc4e1d8}));root.add(ray);
      const lightPoint=new THREE.Mesh(new THREE.SphereGeometry(.045,16,12),new THREE.MeshBasicMaterial({color:0xeffff6}));lightPoint.position.set(1.45,1.3,-.35);root.add(lightPoint);
      for(let i=0;i<5;i++){const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.2+i*.6,-1.0,-1.2),new THREE.Vector3(-2.2+i*.6,-1,1.1)]),new THREE.LineBasicMaterial({color:0x315053,transparent:true,opacity:.3}));root.add(l);}
    }
    renderer.render(scene,camera);assets['milestone-'+kind]=renderer.domElement.toDataURL('image/png').split(',')[1];scene.remove(root);
    root.traverse(o=>{o.geometry?.dispose();});
  }
  renderer.dispose();environment.dispose();generator.dispose();return assets;
});
for(const [name,data]of Object.entries(rendered))await writeFile(path.join(output,name+'.png'),Buffer.from(data,'base64'));
await browser.close();
execFileSync('python3', ['-c', `
from PIL import Image
from pathlib import Path
import sys
for p in Path(sys.argv[1]).glob('*.png'):
 im=Image.open(p)
 bounds=im.getchannel('A').getbbox()
 if bounds:
  pad=12 if p.stem.startswith('milestone-') else 16
  x,y,r,b=bounds
  im=im.crop((max(0,x-pad),max(0,y-pad),min(im.width,r+pad),min(im.height,b+pad)))
 im.save(p.with_suffix('.webp'),quality=90,method=6)
 p.unlink()
`, output]);
console.log(`Rendered ${Object.keys(rendered).length} transparent thumbnails.`);
