import * as THREE from 'three';

// Dimensionally based on the 304 × 137 × 40 mm RTX 5090 Founders Edition.
// Reconstructed from NVIDIA's public photography; not manufacturer mechanical CAD.
const WIDTH = 8.4;
const DEPTH = 3.785;

function polygonShape(points, radius = 0.10) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points.length; i += 1) {
    const prev = new THREE.Vector2(...points[(i + points.length - 1) % points.length]);
    const here = new THREE.Vector2(...points[i]);
    const next = new THREE.Vector2(...points[(i + 1) % points.length]);
    const from = here.clone().lerp(prev, Math.min(radius / here.distanceTo(prev), 0.45));
    const to = here.clone().lerp(next, Math.min(radius / here.distanceTo(next), 0.45));
    if (i === 0) shape.moveTo(from.x, from.y);
    else shape.lineTo(from.x, from.y);
    shape.quadraticCurveTo(here.x, here.y, to.x, to.y);
  }
  shape.closePath();
  return shape;
}

function outline(width, depth, radius = 0.25) {
  return polygonShape([[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]], radius);
}

function extrude(shape, height, bevel = 0.025) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 6, curveSegments: 18, steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -height / 2, 0);
  return geometry;
}

function metalGrain() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(512, 512);
  let seed = 60151;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = 175 + (seed >>> 26);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  ctx.globalAlpha = 0.10;
  for (let y = 0; y < 512; y += 2) {
    ctx.fillStyle = y % 4 ? '#ffffff' : '#343434';
    ctx.fillRect(0, y, 512, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

export function createHardwareModel() {
  const resources = new Set();
  const textures = new Set();
  const grain = metalGrain();
  textures.add(grain);
  const materials = {
    frame: new THREE.MeshPhysicalMaterial({color: '#353c40', metalness: 0.96, roughness: 0.3, roughnessMap: grain, bumpMap: grain, bumpScale: 0.009, anisotropy: 0.45, clearcoat: 0.18, clearcoatRoughness: 0.35}),
    insert: new THREE.MeshStandardMaterial({color: '#202326', metalness: 0.80, roughness: 0.49, roughnessMap: grain, bumpMap: grain, bumpScale: 0.013}),
    edge: new THREE.MeshStandardMaterial({color: '#959f9f', metalness: 1, roughness: 0.26}),
    fin: new THREE.MeshStandardMaterial({color: '#35393d', metalness: 0.97, roughness: 0.32}),
    finEdge: new THREE.MeshStandardMaterial({color: '#8d9398', metalness: 1, roughness: 0.24}),
    black: new THREE.MeshStandardMaterial({color: '#090b0e', metalness: 0.26, roughness: 0.50}),
    blade: new THREE.MeshPhysicalMaterial({color: '#252c30', metalness: 0.50, roughness: 0.3, roughnessMap: grain, bumpMap: grain, bumpScale: 0.006, clearcoat: 0.08}),
    pcb: new THREE.MeshStandardMaterial({color: '#172422', metalness: 0.35, roughness: 0.59}),
    solder: new THREE.MeshStandardMaterial({color: '#aaa9a0', metalness: 0.92, roughness: 0.28}),
    ceramic: new THREE.MeshStandardMaterial({color: '#464340', metalness: 0.15, roughness: 0.68}),
    copper: new THREE.MeshStandardMaterial({color: '#454545', metalness: 0.96, roughness: 0.33}),
    gold: new THREE.MeshStandardMaterial({color: '#d3ba6c', metalness: 0.92, roughness: 0.23}),
    silicon: new THREE.MeshPhysicalMaterial({color: '#49434b', metalness: 0.96, roughness: 0.1, iridescence: 0.62, iridescenceIOR: 1.4, iridescenceThicknessRange: [150, 440], clearcoat: 1}),
    trace: new THREE.MeshStandardMaterial({color: '#526a54', metalness: 0.80, roughness: 0.39}),
  };
  const root = new THREE.Group();
  const shroud = new THREE.Group();
  const cooler = new THREE.Group();
  const fans = new THREE.Group();
  const board = new THREE.Group();
  const backplate = new THREE.Group();
  const ioBracket = new THREE.Group();
  root.add(shroud, cooler, fans, board, backplate, ioBracket);

  function mesh(geometry, material, parent, position = [0, 0, 0]) {
    resources.add(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...position);
    parent.add(m);
    return m;
  }
  function box(parent, size, position, material, radius = 0) {
    return mesh(radius ? extrude(outline(size[0], size[2], radius), size[1], Math.min(0.018, size[1] * 0.15)) : new THREE.BoxGeometry(...size), material, parent, position);
  }
  function cylinder(parent, radius, height, position, material, segments = 32) {
    return mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material, parent, position);
  }
  function ring(parent, radius, tube, position, material) {
    const m = mesh(new THREE.TorusGeometry(radius, tube, 6, 96), material, parent, position);
    m.rotation.x = Math.PI / 2;
    return m;
  }
  function instances(parent, geometry, material, transforms) {
    resources.add(geometry);
    const instanced = new THREE.InstancedMesh(geometry, material, transforms.length);
    const dummy = new THREE.Object3D();
    transforms.forEach((t, i) => {
      dummy.position.set(...t.p);
      dummy.scale.set(...(t.s || [1, 1, 1]));
      dummy.rotation.set(...(t.r || [0, 0, 0]));
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    parent.add(instanced);
    return instanced;
  }
  function screw(parent, x, y, z, radius = 0.047) {
    cylinder(parent, radius, 0.022, [x, y, z], materials.edge, 16);
    cylinder(parent, radius * 0.60, 0.024, [x, y + 0.006, z], materials.black, 6);
    cylinder(parent, radius * 0.32, 0.026, [x, y + 0.007, z], materials.insert, 6);
  }
  function label(parent, text, width, height, position, rotation = [-Math.PI / 2, 0, 0], color = '#c3c9c9') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = '500 78px Arial, sans-serif';
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 66, 990);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    textures.add(map);
    const material = new THREE.MeshBasicMaterial({map, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false});
    materials[`label${Object.keys(materials).length}`] = material;
    const m = mesh(new THREE.PlaneGeometry(width, height), material, parent, position);
    m.rotation.set(...rotation);
    return m;
  }

  // One-piece softly machined X chassis. The actual cutouts remain open through
  // the card; no dark solid rectangle is used to fake the flow-through windows.
  const leftWindow = [[-3.97, -1.66], [-1.57, -1.66], [-0.37, -0.23], [-0.37, 0.23], [-1.57, 1.66], [-3.97, 1.66]];
  const rightWindow = leftWindow.map(([x, z]) => [-x, z]).reverse();
  const outer = outline(WIDTH, DEPTH, 0.36);
  outer.holes.push(new THREE.Path(polygonShape(leftWindow, 0.18).getPoints(12)));
  outer.holes.push(new THREE.Path(polygonShape(rightWindow, 0.18).getPoints(12)));
  mesh(extrude(outer, 0.79, 0.095), materials.frame, shroud, [0, 0.01, 0]);
  // Faint uninterrupted bevel highlights on the airflow openings.
  for (const points of [leftWindow, rightWindow]) {
    const path = polygonShape(points, 0.18).getPoints(12);
    const curve = new THREE.CatmullRomCurve3(path.map(v => new THREE.Vector3(v.x, 0.492, -v.y)), true);
    mesh(new THREE.TubeGeometry(curve, 160, 0.014, 4, true), materials.edge, shroud);
  }
  // Dark triangular center inlays make the exact X silhouette legible.
  for (const sign of [-1, 1]) {
    const top = polygonShape([[-1.48, sign * 1.73], [1.48, sign * 1.73], [0.0, sign * 0.11]], 0.07);
    mesh(extrude(top, 0.016, 0.012), materials.insert, shroud, [0, 0.483, 0]);
    mesh(extrude(top, 0.016, 0.012), materials.insert, shroud, [0, -0.483, 0]);
  }

  // Thin individually separated cooling vanes, clipped to the trapezoidal holes.
  // Instances preserve crisp, sub-pixel metal highlights without hundreds of calls.
  const finsTransforms = [];
  const finRidges = [];
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 93; i += 1) {
      const xx = 0.48 + i * 0.0374;
      const half = Math.min(1.62, 0.26 + Math.max(0, xx - 0.38) * 1.2);
      const x = sign * xx;
      finsTransforms.push({p: [x, 0.025, 0], s: [0.014, 0.78, half * 2]});
      finRidges.push({p: [x, 0.423, 0], s: [0.011, 0.009, half * 2 - 0.026]});
    }
  }
  instances(cooler, new THREE.BoxGeometry(1, 1, 1), materials.fin, finsTransforms);
  instances(cooler, new THREE.BoxGeometry(1, 1, 1), materials.finEdge, finRidges);
  // Vapor chamber, contact plate, soldered heatpipe runs visible after separation.
  mesh(extrude(polygonShape([[-1.38,-1.39],[1.38,-1.39],[1.52,0],[1.38,1.39],[-1.38,1.39],[-1.52,0]],0.14),0.11,0.025), materials.copper,cooler,[0,0.03,0]);
  box(cooler,[1.23,0.055,1.18],[0,-0.065,0],materials.edge,0.08);
  for (const z of [-1.0, -0.53, 0.53, 1.0]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.72,0.06,z),new THREE.Vector3(-2.0,0.0,z),new THREE.Vector3(-0.8,-0.02,z*0.6),
      new THREE.Vector3(0.8,-0.02,z*0.6),new THREE.Vector3(2.0,0.0,z),new THREE.Vector3(3.72,0.06,z),
    ]);
    mesh(new THREE.TubeGeometry(path,40,0.075,8,false),materials.copper,cooler);
  }

  // Axial fan rotors sit on the reverse side of both open heatsink sections.
  const rotors = [];
  // Subdivided airfoil surfaces provide continuous curvature across each
  // blade; bending only an extruded outline leaves visible triangular facets.
  const radialSteps=36, widthSteps=16, bladePositions=[], bladeUVs=[], bladeIndices=[];
  const stride=widthSteps+1, layerSize=(radialSteps+1)*stride;
  for(let side=0;side<2;side+=1) for(let u=0;u<=radialSteps;u+=1) for(let v=0;v<=widthSteps;v+=1){
    const t=u/radialSteps, q=v/widthSteps-.5;
    const radius=.265+1.09*t;
    const sweep=.19-.47*Math.pow(t,.85);
    const span=.96-.12*t;
    const angle=sweep+q*span;
    const camber=.083*Math.cos(q*Math.PI)*Math.sin(t*Math.PI*.78);
    const pitch=q*radius*.21+.027*Math.sin(t*Math.PI);
    bladePositions.push(radius*Math.cos(angle),camber+pitch+(side===0?.014:-.014),radius*Math.sin(angle));
    bladeUVs.push(t,q+.5);
  }
  for(let side=0;side<2;side+=1) for(let u=0;u<radialSteps;u+=1) for(let v=0;v<widthSteps;v+=1){
    const a=side*layerSize+u*stride+v,b=a+stride,c=a+1,d=b+1;
    bladeIndices.push(...(side===0?[a,c,b,c,d,b]:[a,b,c,c,b,d]));
  }
  const border=[];
  for(let u=0;u<=radialSteps;u++)border.push(u*stride);
  for(let v=1;v<=widthSteps;v++)border.push(radialSteps*stride+v);
  for(let u=radialSteps-1;u>=0;u--)border.push(u*stride+widthSteps);
  for(let v=widthSteps-1;v>0;v--)border.push(v);
  for(let i=0;i<border.length;i++){const a=border[i],b=border[(i+1)%border.length];bladeIndices.push(a,b,a+layerSize,b,b+layerSize,a+layerSize)}
  const bladeGeometry=new THREE.BufferGeometry();
  bladeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(bladePositions,3));
  bladeGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(bladeUVs,2));
  bladeGeometry.setIndex(bladeIndices);bladeGeometry.computeVertexNormals();
  for (const x of [-2.41,2.41]) {
    const fan = new THREE.Group();
    fan.position.set(x,-0.51,0);
    fans.add(fan);
    ring(fan,1.40,0.035,[0,0,0],materials.insert);
    ring(fan,1.45,0.018,[0,0,0],materials.edge);
    const rotor = new THREE.Group(); fan.add(rotor); rotors.push(rotor);
    for (let i=0;i<7;i+=1) {
      const b=mesh(bladeGeometry,materials.blade,rotor);
      b.rotation.y=i*Math.PI*2/7; b.rotation.z=0.035;
    }
    cylinder(rotor,0.39,0.13,[0,-0.015,0],materials.black,64);
    cylinder(rotor,0.35,0.017,[0,-0.09,0],materials.blade,64);
    ring(rotor,0.35,0.006,[0,-0.10,0],materials.frame);
    for (let i=0;i<3;i+=1) {
      const a=i*Math.PI*2/3;
      const arm=box(fan,[0.10,0.07,1.10],[Math.sin(a)*0.84,0.115,Math.cos(a)*0.84],materials.black);
      arm.rotation.y=a;
    }
  }

  // Compact central PCB, separate from the two unobstructed cooling windows.
  const boardShape = polygonShape([[-1.58,-1.48],[1.55,-1.48],[1.96,-0.74],[1.53,1.55],[-1.53,1.55],[-1.95,-0.76]],0.07);
  mesh(extrude(boardShape,0.075,0.006),materials.pcb,board,[0,-0.57,0]);
  box(board,[1.63,0.08,1.60],[0,-0.478,0],materials.black,0.04);
  box(board,[1.02,0.035,1.03],[0,-0.415,0],materials.silicon,0.012);
  // 16 memory ICs around the GPU package, with edge markings and BGA rims.
  const memories=[];
  for (const side of [-1,1]) {
    for(let i=0;i<4;i+=1) {
      memories.push([side*1.17,-0.472,-0.70+i*0.465]);
      memories.push([-0.70+i*0.465,-0.472,side*1.12]);
    }
  }
  memories.forEach(([x,y,z])=>{
    box(board,[0.30,0.072,0.36],[x,y,z],materials.black,0.018);
    box(board,[0.24,0.002,0.025],[x,y+0.039,z-0.06],materials.insert);
    cylinder(board,0.012,0.003,[x-0.10,y+0.040,z-0.12],materials.solder,8);
  });
  // Four repeated VRM banks, ceramic capacitors, visible solder end caps.
  const smd=[], solder=[], traces=[];
  for(let row=0;row<7;row+=1) for(let side of [-1,1]) {
    const x=side*(1.64-0.03*row),z=-0.92+row*0.29;
    smd.push({p:[x,-0.448,z],s:[0.17,0.11,0.15]});
    for(let j=0;j<3;j+=1) {
      const zz=z+(j-1)*0.055;
      smd.push({p:[x-side*0.17,-0.485,zz],s:[0.065,0.035,0.034]});
      solder.push({p:[x-side*0.21,-0.483,zz],s:[0.018,0.038,0.035]});
    }
  }
  for(let i=0;i<180;i+=1){
    const angle=i*2.39996,radius=0.91+(i%11)*0.043;
    const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
    if(Math.abs(x)>0.95&&Math.abs(z)>0.85) continue;
    smd.push({p:[x,-0.487,z],s:[0.040,0.022,0.020]});
    solder.push({p:[x+0.026,-0.487,z],s:[0.012,0.025,0.022]});
  }
  instances(board,new THREE.BoxGeometry(1,1,1),materials.ceramic,smd);
  instances(board,new THREE.BoxGeometry(1,1,1),materials.solder,solder);
  for(let i=0;i<36;i+=1){
    const z=-1.27+i*0.07;
    traces.push({p:[-0.82,-0.528,z],s:[0.48,0.002,0.007]});
    traces.push({p:[0.82,-0.528,z],s:[0.48,0.002,0.007]});
  }
  instances(board,new THREE.BoxGeometry(1,1,1),materials.trace,traces);

  // Three-board FE design: PCIe edge connector on its own slim extension.
  box(board,[3.70,0.062,0.34],[-0.55,-0.57,1.75],materials.pcb,0.03);
  const contacts=[];
  for(let i=0;i<52;i+=1)if(i!==10&&i!==11){
    contacts.push({p:[-2.30+i*0.067,-0.533,1.80],s:[0.042,0.008,0.24]});
  }
  instances(board,new THREE.BoxGeometry(1,1,1),materials.gold,contacts);
  // 12V-2x6 connector housing with twelve individually recessed contacts.
  box(board,[0.73,0.24,0.28],[0.68,-0.36,-1.57],materials.black,0.035);
  for(let row=0;row<2;row+=1)for(let i=0;i<6;i+=1){
    box(board,[0.065,0.065,0.02],[0.405+i*0.109,-0.415+row*0.11,-1.718],materials.insert);
    box(board,[0.019,0.026,0.024],[0.405+i*0.109,-0.415+row*0.11,-1.731],materials.gold);
  }
  box(board,[0.34,0.072,0.19],[0.68,-0.221,-1.62],materials.black,0.02);
  for(let i=0;i<4;i++)box(board,[0.039,0.026,0.02],[0.56+i*.08,-.213,-1.721],materials.gold,.004);
  for(const x of [-1.44,1.44])for(const z of [-1.29,1.29])screw(board,x,-0.511,z,0.045);
  label(board,'GB202-300-A1',0.72,0.075,[0,-0.394,0.22],[-Math.PI/2,0,0],'#9c9992');

  // Peripheral I/O bracket with sockets, ventilation and mounting ears.
  box(ioBracket,[0.055,1.09,3.65],[-4.27,-0.13,0],materials.edge,0.04);
  for(let i=0;i<4;i+=1){
    const z=-1.2+i*0.76;
    box(ioBracket,[0.06,0.19,0.52],[-4.305,-0.30,z],materials.black,0.012);
    box(ioBracket,[0.062,0.08,0.38],[-4.34,-0.29,z],materials.frame);
  }
  const vents=[];
  for(let i=0;i<20;i+=1)vents.push({p:[-4.31,0.105,-1.55+i*0.162],s:[0.009,0.22,0.060]});
  instances(ioBracket,new THREE.BoxGeometry(1,1,1),materials.black,vents);
  box(ioBracket,[0.17,0.07,0.25],[-4.34,0.45,-1.65],materials.edge,0.02);
  box(ioBracket,[0.17,0.07,0.25],[-4.34,0.45,1.65],materials.edge,0.02);

  // Small lower center cover, leaving both fan apertures genuinely open.
  mesh(extrude(polygonShape([[-1.45,-1.69],[1.45,-1.69],[0.42,-0.13],[1.45,1.69],[-1.45,1.69],[-0.42,-0.13]],0.08),0.038,0.012),materials.insert,backplate,[0,-0.52,0]);
  for(const x of [-0.96,0.96])for(const z of [-1.16,1.16])screw(backplate,x,-0.55,z);
  label(shroud,'GEFORCE RTX',2.06,0.24,[2.48,-0.04,1.938],[0,0,0],'#d7dddd');
  label(shroud,'GEFORCE RTX',2.06,0.24,[2.48,0.04,-1.938],[Math.PI,0,0],'#d7dddd');
  label(shroud,'RTX 5090',0.71,0.11,[-0.79,0.519,1.43],[-Math.PI/2,0,0],'#b1b5b7');
  // Tiny corner fasteners and continuous side machining seams.
  for(const x of [-4.02,4.02])for(const z of [-1.67,1.67]){screw(shroud,x,0.488,z,0.034);screw(shroud,x,-0.49,z,0.029);}
  for(const sign of [-1,1]){
    box(shroud,[0.014,0.42,0.021],[-1.48,-0.04,sign*1.930],materials.black);
    box(shroud,[0.014,0.42,0.021],[1.48,-0.04,sign*1.930],materials.black);
    for(let i=0;i<2;i+=1) box(shroud,[1.85,0.035,0.022],[-0.10,-0.12+i*0.16,sign*1.932],materials.black,0.012);
  }

  let disposed = false;
  return {
    root, shroud, cooler, fans, board, backplate, ioBracket, rotors, materials,
    anchors: {
      board: {object: board, point: new THREE.Vector3(.65,-.612,-1.1)},
      cooler: {object: cooler, point: new THREE.Vector3(2.7,0.42,-0.30)},
      memory: {object: board, point: new THREE.Vector3(1.17,-0.42,0.23)},
      die: {object: board, point: new THREE.Vector3(0,-0.39,0)},
    },
    setOpacity(opacity) {
      for(const material of Object.values(materials)) {
        const isLabel=Boolean(material.map);
        const transparent=isLabel || opacity<0.999;
        if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}
        material.opacity=opacity*(isLabel?0.9:1);
        material.depthWrite=!isLabel&&opacity>0.35;
      }
    },
    dispose() {
      if(disposed)return; disposed=true;
      resources.forEach(g=>g.dispose());
      Object.values(materials).forEach(m=>m.dispose());
      textures.forEach(t=>t.dispose());
    },
  };
}
