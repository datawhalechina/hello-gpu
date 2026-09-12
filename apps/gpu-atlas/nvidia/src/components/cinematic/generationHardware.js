import * as THREE from 'three';

/**
 * Public-reference visual reconstructions. These are hand-built presentation
 * meshes, not NVIDIA CAD. Repeated board components depict the component
 * classes and packaging of the period, not an electrically valid PCB netlist.
 * The data-center representatives are the real PCIe products, with closed
 * dual-slot enclosures and passive airflow. They have no display outputs or
 * onboard fans. The removable layers are explanatory, not a service procedure.
 */
export const HARDWARE_REFERENCES = {
  tesla: ['https://developer.download.nvidia.com/presentations/2007/GDC_China/GDC_Shanghai_07_G80_cn.pdf'],
  fermi: ['https://www.nvidia.com/en-us/drivers/GTX-400-architecture/', 'https://www.nvidia.com/docs/IO/90025/GTX-480-470-Web-Datasheet-Final4.pdf'],
  kepler: ['https://www.nvidia.com/en-us/geforce/graphics-cards/geforce-gtx-680/product-images/'],
  maxwell: ['https://www.nvidia.com/en-us/geforce/900-series/', 'https://www.nvidia.com/content/geforce-gtx/gtx_980_user_guide.pdf'],
  pascal: ['https://www.nvidia.com/content/geforce-gtx/GEFORCE_GTX_1080_Ti_USER_GUIDE_v02.pdf', 'https://www.nvidia.com/en-us/geforce/news/nvidia-geforce-gtx-1080-ti/'],
  volta: ['https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/tesla-product-literature/Tesla-V100-PCIe-Product-Brief.pdf', 'https://www.nvidia.com/en-gb/data-center/tesla-product-literature/'],
  turing: ['https://www.nvidia.com/en-us/geforce/news/geforce-rtx-founders-graphics-card-breakdown/'],
  ampere: ['https://www.nvidia.com/en-us/data-center/a100/', 'https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/PB-10577-001_v02.pdf'],
  hopper: ['https://www.nvidia.com/content/dam/en-zz/Solutions/gtcs22/data-center/h100/PB-11133-001_v01.pdf'],
  ada: ['https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/'],
};

const PROFILES = {
  tesla: { shape: 'blower', width: 8.10, depth: 3.42, height: 1.02, pcb: '#163626', frame: '#25292a', blower: 1.01, memory: 12, powerPins: [6, 6], title: 'GEFORCE 8800 GTX' },
  fermi: { shape: 'blower', width: 8.02, depth: 3.36, height: 1.05, pcb: '#1c2926', frame: '#262a2c', blower: 1.02, memory: 12, powerPins: [6, 8], title: 'GEFORCE GTX 480' },
  kepler: { shape: 'blower', width: 7.45, depth: 3.31, height: .96, pcb: '#202b25', frame: '#272c2d', blower: 1.0, memory: 8, powerPins: [6, 6], title: 'GEFORCE GTX 680' },
  maxwell: { shape: 'blower', width: 8.05, depth: 3.38, height: 1.0, pcb: '#212925', frame: '#a8aaad', blower: 1.06, memory: 8, powerPins: [6, 6], title: 'GTX 980' },
  pascal: { shape: 'blower', width: 8.05, depth: 3.37, height: 1.04, pcb: '#202a26', frame: '#a9adb0', blower: 1.07, memory: 11, powerPins: [6, 8], title: 'GTX 1080 Ti' },
  volta: { shape: 'pcie-passive', width: 8.05, depth: 3.34, height: 1.02, pcb: '#1c2826', frame: '#a99963', memory: 4, title: 'TESLA V100', packageWidth: 2.32, packageDepth: 2.12 },
  turing: { shape: 'dual', width: 8.15, depth: 3.38, height: 1.08, pcb: '#182421', frame: '#b9bdc1', memory: 11, powerPins: [8, 8], title: 'RTX 2080 Ti' },
  ampere: { shape: 'pcie-passive', width: 8.05, depth: 3.34, height: 1.04, pcb: '#171e22', frame: '#afa68b', memory: 5, title: 'NVIDIA A100', packageWidth: 2.68, packageDepth: 2.38 },
  hopper: { shape: 'pcie-passive', width: 8.05, depth: 3.34, height: 1.05, pcb: '#191e23', frame: '#ae975f', memory: 5, title: 'NVIDIA H100', packageWidth: 2.70, packageDepth: 2.38 },
  ada: { shape: 'flow', width: 8.42, depth: 3.74, height: 1.70, pcb: '#152420', frame: '#8f8d80', memory: 12, powerPins: [12], title: 'RTX 4090' },
};

function outline(points, radius = .08) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => {
    const prev = new THREE.Vector2(...points[(i + points.length - 1) % points.length]);
    const here = new THREE.Vector2(x, z);
    const next = new THREE.Vector2(...points[(i + 1) % points.length]);
    const a = here.clone().lerp(prev, Math.min(.45, radius / here.distanceTo(prev)));
    const b = here.clone().lerp(next, Math.min(.45, radius / here.distanceTo(next)));
    if (!i) shape.moveTo(a.x, a.y); else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(x, z, b.x, b.y);
  });
  shape.closePath(); return shape;
}
function rect(w, d, r = .1) { return outline([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], r); }
function geometryOf(shape, height, bevel = .012) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 16 });
  g.rotateX(-Math.PI / 2); g.translate(0, -height / 2, 0); return g;
}
function holeCircle(shape, x, z, r) {
  const path = new THREE.Path(); path.absarc(x, -z, r, 0, Math.PI * 2, true); shape.holes.push(path);
}
function holeRect(shape, x, z, w, d, r = .04) {
  const points = rect(w, d, r).getPoints(16).map(p => new THREE.Vector2(p.x + x, p.y - z));
  shape.holes.push(new THREE.Path(points));
}

export function createGenerationHardware(generation) {
  const id = generation?.id || 'tesla';
  const profile = PROFILES[id];
  if (!profile) throw new Error(`No historical hardware profile for ${id}`);
  const { width: W, depth: D, height: H, shape } = profile;
  const resources = new Set(), textures = new Set(), materials = new Set();
  const root = new THREE.Group(); root.name = `${id}-hardware`;
  const shroud = new THREE.Group(), cooler = new THREE.Group(), fans = new THREE.Group(), board = new THREE.Group(), backplate = new THREE.Group(), thermal = new THREE.Group();
  for (const [name, group] of Object.entries({ shroud, cooler, fans, board, backplate, thermal })) { group.name = `${id}-${name}`; root.add(group); }
  const ioBracket = id === 'ada' ? new THREE.Group() : null;
  if (ioBracket) { ioBracket.name = 'ada-io-bracket'; root.add(ioBracket); }
  const rotors = [];
  function material(params, physical = false) {
    const result = physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
    materials.add(result); return result;
  }
  const grainCanvas = document.createElement('canvas'); grainCanvas.width = grainCanvas.height = 512;
  const grainCtx = grainCanvas.getContext('2d'), noise = grainCtx.createImageData(512, 512); let random = 32113;
  for (let i = 0; i < noise.data.length; i += 4) {
    random = (random * 1664525 + 1013904223) >>> 0;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = 154 + (random >>> 26); noise.data[i + 3] = 255;
  }
  grainCtx.putImageData(noise, 0, 0); grainCtx.fillStyle = '#999'; grainCtx.globalAlpha = .16;
  for (let y = 0; y < 512; y += 2) grainCtx.fillRect(0, y, 512, 1);
  const grain = new THREE.CanvasTexture(grainCanvas); grain.wrapS = grain.wrapT = THREE.RepeatWrapping; textures.add(grain);
  const M = {
    frame: material({ color: profile.frame, metalness: .97, roughness: .31, roughnessMap: grain, bumpMap: grain, bumpScale: .006, anisotropy: .35 }, true),
    black: material({ color: '#0b0e11', metalness: .23, roughness: .52 }),
    plastic: material({ color: '#202629', metalness: .28, roughness: .48, roughnessMap: grain }),
    fin: material({ color: id === 'fermi' ? '#949da0' : '#51585d', metalness: .95, roughness: .32 }),
    edge: material({ color: '#bdc2c6', metalness: .97, roughness: .23 }),
    darkMetal: material({ color: '#31383c', metalness: .9, roughness: .35 }),
    pcb: material({ color: profile.pcb, metalness: .23, roughness: .59 }),
    substrate: material({ color: '#244437', metalness: .55, roughness: .44 }),
    copper: material({ color: '#a27450', metalness: .95, roughness: .3 }),
    gold: material({ color: '#cab471', metalness: .94, roughness: .27 }),
    solder: material({ color: '#a8b3b2', metalness: .95, roughness: .3 }),
    ceramic: material({ color: '#777363', metalness: .27, roughness: .64 }),
    memory: material({ color: '#242829', metalness: .35, roughness: .46 }),
    silicon: material({ color: '#625757', metalness: .91, roughness: .16, iridescence: .35, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 410], clearcoat: .95 }, true),
    green: material({ color: '#76b900', emissive: '#467b04', emissiveIntensity: .14, metalness: .3, roughness: .44 }),
  };
  function mesh(geometry, mat, parent, pos = [0, 0, 0]) {
    resources.add(geometry); const object = new THREE.Mesh(geometry, mat); object.position.set(...pos); parent.add(object); return object;
  }
  function box(parent, size, pos, mat, radius = 0) { return mesh(radius ? geometryOf(rect(size[0], size[2], radius), size[1], Math.min(.015, size[1] * .1)) : new THREE.BoxGeometry(...size), mat, parent, pos); }
  function cyl(parent, r, h, pos, mat, segments = 32) { return mesh(new THREE.CylinderGeometry(r, r, h, segments), mat, parent, pos); }
  function ring(parent, r, tube, pos, mat) { const object = mesh(new THREE.TorusGeometry(r, tube, 8, 96), mat, parent, pos); object.rotation.x = Math.PI / 2; return object; }
  function inst(parent, mat, transforms, geometry = new THREE.BoxGeometry(1, 1, 1)) {
    resources.add(geometry); const object = new THREE.InstancedMesh(geometry, mat, transforms.length), dummy = new THREE.Object3D();
    transforms.forEach((t, i) => { dummy.position.set(...t.p); dummy.rotation.set(...(t.r || [0, 0, 0])); dummy.scale.set(...(t.s || [1, 1, 1])); dummy.updateMatrix(); object.setMatrixAt(i, dummy.matrix); });
    object.instanceMatrix.needsUpdate = true; object.computeBoundingSphere(); parent.add(object); return object;
  }
  function screw(parent, x, y, z, r = .056) {
    cyl(parent, r, .024, [x, y, z], M.edge, 24); cyl(parent, r * .60, .026, [x, y + .004, z], M.black, 6);
    box(parent, [.063, .004, .014], [x, y + .019, z], M.darkMetal);
  }
  function text(parent, value, w, h, pos, color = '#d1d4d3', rotation = [-Math.PI / 2, 0, 0]) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 160;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.font = '600 85px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(value, 512, 80, 1000);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; textures.add(map);
    const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }); materials.add(mat);
    const object = mesh(new THREE.PlaneGeometry(w, h), mat, parent, pos); object.rotation.set(...rotation); return object;
  }
  function tube(parent, points, radius, mat) { return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 48, radius, 10, false), mat, parent); }
  function fan(x, y, radius, count = 13, reverse = false, blower = false) {
    const assembly = new THREE.Group(); assembly.position.set(x, y, 0); if (reverse) assembly.rotation.z = Math.PI; fans.add(assembly);
    ring(assembly, radius + .035, .025, [0, 0, 0], M.darkMetal);
    ring(assembly, radius + .075, .017, [0, .012, 0], M.edge);
    const rotor = new THREE.Group(); assembly.add(rotor); rotors.push(rotor);
    cyl(rotor, blower ? radius * .76 : radius * .235, blower ? .12 : .10, [0, -.025, 0], M.black, 64);
    cyl(rotor, blower ? radius * .43 : radius * .225, .017, [0, .047, 0], M.darkMetal, 64);
    if (blower) {
      const transforms = [];
      for (let i = 0; i < 48; i++) { const a = i * Math.PI * 2 / 48; transforms.push({ p: [Math.cos(a) * radius * .84, -.022, Math.sin(a) * radius * .84], s: [.019, .19, radius * .31], r: [0, Math.PI / 2 - a + .31, 0] }); }
      inst(rotor, M.darkMetal, transforms);
      ring(rotor, radius * .995, .023, [0, .025, 0], M.plastic);
    } else {
      const positions = [], uv = [], indexes = [], rows = 26, cols = 10;
      for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
        const t = i / rows, q = j / cols - .5, r = radius * (.22 + .755 * t), a = .2 - .5 * t + q * (count === 7 ? .78 : .5);
        positions.push(Math.cos(a) * r, .07 * Math.sin(t * Math.PI) * Math.cos(q * Math.PI) + q * r * .22, Math.sin(a) * r); uv.push(t, q + .5);
      }
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = i * (cols + 1) + j, b = a + cols + 1; indexes.push(a, a + 1, b, a + 1, b + 1, b); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indexes); g.computeVertexNormals();
      const mat = material({ color: '#31383c', metalness: .52, roughness: .40, roughnessMap: grain, side: THREE.DoubleSide });
      for (let i = 0; i < count; i++) { const blade = mesh(g, mat, rotor); blade.rotation.y = i * Math.PI * 2 / count; }
      text(rotor, 'NVIDIA', radius * .35, radius * .067, [0, .061, 0], '#92999b');
    }
    return assembly;
  }

  // Solder-mask trace texture is a deterministic etched surface. It adds
  // silkscreen and via detail without presenting an invented circuit netlist.
  function boardSurface(w, d, y) {
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = profile.pcb; ctx.fillRect(0, 0, 2048, 1024);
    ctx.strokeStyle = shape === 'pcie-passive' ? '#384147' : id === 'tesla' ? '#345744' : '#365240'; ctx.lineWidth = 1;
    for (let i = 0; i < 420; i++) {
      const x = (i * 127 + 91) % 2020 + 14, z = (i * 79 + 27) % 1000 + 12, len = 15 + (i % 9) * 7;
      ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(x + len, z); ctx.lineTo(x + len + 8, z + 8); ctx.lineTo(x + len + 8, z + 18); ctx.stroke();
      ctx.fillStyle = '#657353'; ctx.fillRect(x - 1, z - 1, 2, 2);
    }
    ctx.fillStyle = '#bac6af'; ctx.font = '12px monospace';
    for (let i = 0; i < 100; i++) ctx.fillText(`${i % 3 ? 'C' : 'R'}${123 + i * 7}`, 25 + (i * 181) % 1940, 24 + (i * 103) % 960);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; textures.add(map);
    const mat = material({ map, metalness: .28, roughness: .56 }); const face = mesh(new THREE.PlaneGeometry(w, d), mat, board, [0, y, 0]); face.rotation.x = -Math.PI / 2;
  }
  function caps(parent, bank, y) {
    const bodies = [], ends = [];
    bank.forEach(([x, z, s = 1]) => {
      bodies.push({ p: [x, y, z], s: [.067 * s, .033 * s, .035 * s] });
      for (const sign of [-1, 1]) ends.push({ p: [x + sign * .041 * s, y, z], s: [.021 * s, .037 * s, .037 * s] });
    });
    inst(parent, M.ceramic, bodies); inst(parent, M.solder, ends);
  }
  let memoryAnchor = new THREE.Vector3(1.3, -.31, .1);
  let coolerAnchor = new THREE.Vector3(-1.5, .35, -.3);
  let fanAnchor = new THREE.Vector3(W * .32, .47, 0);
  let dieAnchor = new THREE.Vector3(0, -.285, 0);

  function consumerBoard() {
    const compact = id === 'ada', boardWidth = compact ? 4.18 : W - .26;
    box(board, [boardWidth, .075, D - .17], [0, -.43, 0], M.pcb, .05); boardSurface(boardWidth - .04, D - .21, -.389);
    box(board, [1.48, .065, 1.43], [0, -.33, 0], M.substrate, .025);
    const dieSize = id === 'tesla' ? .87 : id === 'kepler' || id === 'maxwell' ? .79 : 1.0;
    box(board, [dieSize, .035, dieSize * 1.03], [0, -.275, 0], id === 'tesla' ? M.edge : M.silicon, .012);
    if (id === 'tesla') text(board, 'NVIDIA  G80', .70, .10, [0, -.254, 0], '#676b64');
    else text(board, generation.chip, .51, .07, [0, -.252, .18], '#b2b1a9');
    const memories = [];
    for (let i = 0; i < profile.memory; i++) {
      const a = Math.PI * 2 * i / profile.memory, x = Math.cos(a) * 1.31, z = Math.sin(a) * 1.12;
      const object = box(board, [.37, .071, .42], [x, -.323, z], M.memory, .012); object.rotation.y = Math.abs(x) > .95 ? Math.PI / 2 : 0;
      text(board, `${generation.memoryType}`, .24, .035, [x, -.284, z], '#667170'); memories.push([x, z]);
    }
    if (memories[0]) memoryAnchor.set(memories[0][0], -.277, memories[0][1]);
    const bank = [];
    for (let row = 0; row < 12; row++) for (const sign of [-1, 1]) {
      const x = sign * (compact ? 1.79 : 2.14), z = -1.28 + row * .225;
      box(board, [.22, .16, .18], [x, -.274, z], M.darkMetal, .019);
      for (let j = 0; j < 2; j++) bank.push([x - sign * .21, z - .045 + j * .09]);
      if (!compact) { cyl(board, .075, .13, [x + sign * .33, -.285, z], M.edge, 16); cyl(board, .067, .004, [x + sign * .33, -.217, z], M.darkMetal, 16); }
    }
    for (let i = 0; i < 220; i++) {
      const x = ((i * .193) % (boardWidth - .5)) - (boardWidth - .5) / 2, z = ((i * .271) % (D - .42)) - (D - .42) / 2;
      if (Math.abs(x) < 1.58 && Math.abs(z) < 1.32 || Math.abs(x) > 1.85 && Math.abs(x) < 2.57) continue;
      bank.push([x, z, .8]);
    }
    caps(board, bank, -.35);
    box(board, [3.56, .073, .31], [-.68, -.43, D / 2 + .025], M.pcb, .025);
    const fingers = [];
    for (let i = 0; i < 52; i++) if (i !== 11 && i !== 12) fingers.push({ p: [-2.42 + i * .067, -.388, D / 2 + .053], s: [.044, .01, .25] });
    inst(board, M.gold, fingers);
    // Era-appropriate power sockets. Small recesses contain separate contacts.
    let powerX = compact ? 1.25 : W / 2 - .48;
    for (const [socketIndex,pins] of profile.powerPins.entries()) {
      const powerY = id === 'kepler' ? -.21 + socketIndex * .30 : -.21;
      const columns = pins / 2, w = columns * .13 + .07;
      box(board, [w, .27, .30], [powerX - w / 2, powerY, -D / 2 + .075], M.black, .025);
      for (let row = 0; row < 2; row++) for (let col = 0; col < columns; col++) {
        const x = powerX - w + .09 + col * .13;
        box(board, [.076, .076, .022], [x, powerY - .06 + row * .118, -D / 2 - .085], M.plastic);
        box(board, [.024, .031, .024], [x, powerY - .06 + row * .118, -D / 2 - .102], M.gold);
      }
      if (pins === 12) {
        box(board, [.34,.09,.16], [powerX-w/2,powerY+.18,-D/2+.005], M.black,.014);
        for(let sense=0;sense<4;sense++) box(board,[.043,.036,.022],[powerX-w/2-.12+sense*.08,powerY+.18,-D/2-.086],M.gold,.004);
      }
      if(id !== 'kepler') powerX -= w + .075;
    }
    const ioAssembly = ioBracket || board;
    // The period's DVI output is wider than the DP/HDMI sockets of RTX cards.
    box(ioAssembly, [.064, H + .10, D + .15], [-W / 2 - .055, -.025, 0], M.edge, .025);
    // SLI / NVLink edge interfaces on the reference graphics cards. Ada omits these.
    if(id !== 'ada') {
      const links=id==='turing'?1:2, span=id==='turing'?.95:.45;
      for(let n=0;n<links;n++){
        const x=-W/2+.60+n*.68;
        box(ioAssembly,[span,.07,.19],[x,-.40,-D/2-.055],M.pcb,.015);
        for(let pin=0;pin<10;pin++)box(ioAssembly,[span/14,.009,.145],[x-span*.42+pin*span*.09,-.357,-D/2-.07],M.gold,.002);
      }
    }
    // Connector families are taken from the actual reference board guides.
    function dviPort(z,y) {
      box(ioAssembly,[.091,.29,1.10],[-W/2-.10,y,z],M.darkMetal,.04);
      box(ioAssembly,[.10,.18,.88],[-W/2-.15,y,z],M.black,.025);
      for(const sign of [-1,1]){const bolt=cyl(ioAssembly,.043,.104,[-W/2-.13,y,z+sign*.59],M.edge,6);bolt.rotation.z=Math.PI/2;}
    }
    function smallPort(z,y,type='dp') {
      const width=type==='usb-c'?.29:type==='mini-hdmi'?.34:.52;
      box(ioAssembly,[.074,.20,width],[-W/2-.09,y,z],M.darkMetal,.016);
      box(ioAssembly,[.087,.105,width-.10],[-W/2-.135,y,z],M.black,.015);
    }
    if(id==='tesla'||id==='fermi') {
      dviPort(-.83,-.20);dviPort(.83,-.20);
      if(id==='tesla'){const port=cyl(ioAssembly,.116,.07,[-W/2-.14,-.20,0],M.black,24);port.rotation.z=Math.PI/2;}
      else smallPort(0,-.20,'mini-hdmi');
    } else if(id==='kepler') {
      dviPort(-.78,-.22);dviPort(-.78,.16);smallPort(.48,-.22,'hdmi');smallPort(1.15,-.22);
    } else if(id==='maxwell') {
      dviPort(-.65,.16);for(const z of [-1.16,-.42,.32])smallPort(z,-.24);smallPort(1.08,-.24,'hdmi');
    } else {
      for(let i=0;i<4;i++)smallPort(-1.15+i*.76,-.25,i===3?'hdmi':'dp');
      if(id==='turing')smallPort(1.17,.18,'usb-c');
    }
    const vents = [];
    for (let i = 0; i < 18; i++) vents.push({ p: [-W / 2 - .09, .20, -D / 2 + .2 + i * (D - .4) / 17], s: [.008, .20, .062] });
    inst(ioAssembly, M.black, vents);
    for (const x of [-.67, .67]) for (const z of [-.64, .64]) screw(board, x, -.345, z, .044);
    if (id !== 'tesla' && id !== 'fermi' && id !== 'kepler' && id !== 'ada') {
      box(backplate, [W - .12, .035, D - .10], [0, -.51, 0], M.darkMetal, .1);
      const ribs = []; for (let i = 0; i < 32; i++) ribs.push({ p: [-W / 2 + .2 + i * (W - .4) / 31, -.535, 0], s: [.016, .012, D - .32] }); inst(backplate, M.black, ribs);
      text(backplate, profile.title, 2.25, .28, [0, -.539, 0], '#72797a', [Math.PI / 2, 0, 0]);
    }
  }

  function blowerCard() {
    const fanX = W / 2 - profile.blower - .27, topY = H / 2 - .025, half = D / 2;
    fanAnchor.set(fanX, topY, 0);
    box(shroud, [W - .05, H - .12, .10], [0, .0, -half + .02], M.plastic, .025);
    box(shroud, [W - .05, H - .12, .10], [0, .0, half - .02], M.plastic, .025);
    box(shroud, [.10, H - .12, D - .1], [W / 2 - .025, .0, 0], M.plastic, .04);
    const top = rect(W - .055, D - .035, id === 'tesla' ? .31 : .11); holeCircle(top, fanX, 0, profile.blower + .028);
    if(id==='tesla')for(let vent=0;vent<4;vent++)holeRect(top,-W/2+.40+vent*.25,0,.13,2.43,.055);
    const window = ['fermi', 'maxwell', 'pascal'].includes(id);
    if (window) holeRect(top, -1.11, 0, 3.13, 2.05, id === 'pascal' ? .025 : .075);
    mesh(geometryOf(top, .095, .017), ['maxwell', 'pascal'].includes(id) ? M.frame : M.plastic, shroud, [0, topY, 0]);
    if (id === 'maxwell' || id === 'pascal') {
      const windowMaterial = material({color:'#7d8b8e',metalness:0,roughness:.18,transparent:true,opacity:.15,depthWrite:false});
      box(shroud,[3.10,.021,2.02],[-1.11,topY+.026,0],windowMaterial,.025);
    }
    fan(fanX, topY - .025, profile.blower, 48, false, true);
    const finStack = [];
    for (let i = 0; i < 100; i++) finStack.push({ p: [-W / 2 + .19 + i * .049, .027, 0], s: [.017, .69, D - .39] });
    inst(cooler, M.fin, finStack);
    if (window) {
      const highlights = [];
      for (let i = 0; i < 63; i++) highlights.push({ p: [-2.62 + i * .049, .375, 0], s: [.016, .014, 2.03] });
      inst(cooler, M.edge, highlights);
    }
    box(cooler, [3.15, .09, 2.20], [-.91, -.272, 0], id === 'tesla' ? M.copper : M.edge, .055);
    for (let i = 0; i < (id === 'fermi' ? 5 : 3); i++) {
      const z = -.76 + i * (id === 'fermi' ? .38 : .76);
      tube(cooler, [[-3.47, -.15, z], [-2.58, -.23, z], [-.35, -.21, z], [.63, -.15, z]], .066, id === 'tesla' ? M.copper : M.edge);
    }
    if (id === 'tesla') {
      // The launch board's long black cover and curved green graphics belong
      // to its period; they are modelled as a thin lacquered surface decal.
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1d2424'; ctx.fillRect(0, 0, 1024, 512);
      const grad = ctx.createLinearGradient(0, 0, 1024, 512); grad.addColorStop(0, '#17271b'); grad.addColorStop(.5, '#315221'); grad.addColorStop(1, '#74a42d');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(0, 15); ctx.bezierCurveTo(450, 50, 610, 240, 1024, 465); ctx.lineTo(1024, 512); ctx.bezierCurveTo(670, 385, 280, 295, 0, 340); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9ad456'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 23); ctx.bezierCurveTo(450, 56, 610, 244, 1024, 465); ctx.stroke();
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; textures.add(map);
      const mat = material({ map, metalness: .12, roughness: .35, clearcoat: .65 }, true);
      const decal = mesh(new THREE.PlaneGeometry(3.9, D - .27), mat, shroud, [-.45, topY + .065, 0]); decal.rotation.x = -Math.PI / 2;
      text(shroud, 'NVIDIA', .59, .12, [fanX, topY + .073, 0], '#c9d1c7');
    } else if (id === 'fermi') {
      // Broad exposed metal ribs distinguish GF100's reference cooler.
      const ribs = []; for (let i = 0; i < 19; i++) ribs.push({ p: [-1.10, topY - .029, -.96 + i * .106], s: [3.06, .063, .043] }); inst(cooler, M.edge, ribs);
      for (let i = 0; i < 5; i++) tube(cooler, [[-2.56 + i * .53, .13, -1.42], [-2.56 + i * .53, .47, -1.58], [-2.56 + i * .53, .52, -1.32]], .086, M.edge);
      text(shroud, 'GEFORCE GTX 480', 1.80, .17, [-1.17, topY + .059, 1.28], '#a9b1b2');
      box(shroud, [.12, .02, 2.61], [.70, topY + .066, 0], M.green, .008);
    } else if (id === 'kepler') {
      // The official GTX 680 has a recessed, finely ribbed black face,
      // not five oversized stepped cover plates.
      box(shroud,[3.76,.041,D-.37],[-1.57,topY+.058,0],M.darkMetal,.07);
      const ribs=[];
      for(let i=0;i<29;i++)ribs.push({p:[-1.56,topY+.084,-1.32+i*.095],s:[3.66,.014,.034]});
      inst(shroud,M.black,ribs);
      tube(shroud,[[.35,topY+.09,-1.30],[.21,topY+.09,-.65],[.18,topY+.09,0],[.21,topY+.09,.65],[.35,topY+.09,1.30]],.012,M.green);
      ring(shroud,profile.blower+.075,.034,[fanX,topY+.027,0],M.darkMetal);
      text(shroud,'NVIDIA',.72,.13,[fanX,topY+.058,0],'#88bb46');
    } else if (id === 'maxwell') {
      // Silver Titan-style border, black fin window and round blower bezel.
      ring(shroud, profile.blower + .105, .055, [fanX, topY + .026, 0], M.frame);
      const surround = rect(3.45, 2.34, .14); holeRect(surround, 0, 0, 3.11, 2.02, .06);
      mesh(geometryOf(surround, .03, .013), M.darkMetal, shroud, [-1.11, topY + .035, 0]);
      for (const x of [-2.70, .48]) for (const z of [-1.09, 1.09]) screw(shroud, x, topY + .068, z, .036);
      text(shroud, profile.title, 1.72, .27, [-1.10, topY + .071, 1.41], '#4c5356');
      text(shroud, 'NVIDIA', .78, .14, [fanX, topY + .054, 0], '#a8b1b5');
    } else {
      // Angular Pascal FE armor, including independent bevelled triangular
      // facets rather than recolouring the rounded Maxwell shell.
      const facets = [
        [[-3.89,-1.60],[-.83,-1.60],[-2.64,-1.12],[-3.62,-.65]],
        [[-.76,-1.60],[1.36,-1.60],[.51,-.34],[.44,-1.07]],
        [[-3.89,1.60],[-.83,1.60],[-2.64,1.12],[-3.62,.65]],
        [[-.76,1.60],[1.36,1.60],[.51,.34],[.44,1.07]],
      ];
      facets.forEach((points, i) => mesh(geometryOf(outline(points, .012), .08, .015), i % 2 ? M.frame : M.edge, shroud, [0, topY + .064, 0]));
      const bezel = new THREE.Shape(); bezel.absarc(fanX, 0, profile.blower + .125, 0, Math.PI * 2); holeCircle(bezel, fanX, 0, profile.blower + .035);
      mesh(geometryOf(bezel, .09, .019), M.darkMetal, shroud, [0, topY + .005, 0]);
      text(shroud, profile.title, 1.43, .21, [-1.10, topY + .162, 1.38], '#464d4e');
      text(shroud, 'NVIDIA', .78, .14, [fanX, topY + .054, 0], '#a3acad');
    }
    text(shroud, 'GEFORCE GTX', 2.30, .22, [-.63, .05, half + .074], id === 'tesla' ? '#b6c6af' : '#8acb58', [0, 0, 0]);
    for (const x of [-W / 2 + .18, W / 2 - .18]) for (const z of [-half + .16, half - .16]) screw(shroud, x, topY + .068, z, .035);
  }

  function dualCard() {
    const topY = .48, xFan = 2.36, r = 1.29;
    const face = rect(W, D, .24); holeCircle(face, -xFan, 0, r + .038); holeCircle(face, xFan, 0, r + .038);
    mesh(geometryOf(face, .14, .022), M.frame, shroud, [0, topY, 0]);
    box(shroud, [W - .12, .90, .10], [0, -.015, -D / 2 + .025], M.frame, .06);
    box(shroud, [W - .12, .90, .10], [0, -.015, D / 2 - .025], M.frame, .06);
    for (const x of [-W / 2 + .06, W / 2 - .06]) box(shroud, [.12, .91, D - .1], [x, -.015, 0], M.frame, .08);
    box(shroud, [1.90, .055, D - .10], [0, topY + .103, 0], M.black, .08);
    const trim = []; for (let i = 0; i < 28; i++) trim.push({ p: [-.84 + i * .062, topY + .136, 0], s: [.012, .01, D - .27] }); inst(shroud, M.plastic, trim);
    text(shroud, 'RTX', 1.15, .34, [0, topY + .146, -.30], '#bfc7ca');
    text(shroud, '2080 Ti', 1.22, .26, [0, topY + .147, .19], '#bfc7ca');
    for (const x of [-xFan, xFan]) { fan(x, topY + .043, r, 13); ring(shroud, r + .058, .025, [x, topY + .092, 0], M.edge); }
    const fins = []; for (let i = 0; i < 141; i++) fins.push({ p: [-W / 2 + .16 + i * (W - .32) / 140, .025, 0], s: [.018, .64, D - .29] }); inst(cooler, M.fin, fins);
    box(cooler, [W - .45, .105, D - .47], [0, -.265, 0], M.edge, .085);
    for (const z of [-1.1, -.57, .57, 1.1]) tube(cooler, [[-3.80, -.23, z], [-1.17, -.25, z * .8], [1.17, -.25, z * .8], [3.80, -.23, z]], .067, M.darkMetal);
    text(shroud, 'GEFORCE RTX', 2.42, .25, [0, .025, D / 2 + .085], '#82c743', [0, 0, 0]);
    for (const x of [-3.87, 3.87]) for (const z of [-1.48, 1.48]) screw(shroud, x, topY + .098, z, .036);
    fanAnchor.set(-xFan, topY + .05, 0); coolerAnchor.set(1.6, .33, -.8);
  }

  function flowCard() {
    const half = D / 2, left = [[-3.99,-1.61],[-1.51,-1.61],[-.45,-.12],[-1.51,1.61],[-3.99,1.61]];
    const right = left.map(([x, z]) => [-x, z]).reverse();
    const shell = rect(W, D, .36);
    shell.holes.push(new THREE.Path(outline(left, .20).getPoints(18)), new THREE.Path(outline(right, .20).getPoints(18)));
    mesh(geometryOf(shell, 1.51, .035), M.frame, shroud, [0, .15, 0]);
    for (const sign of [-1, 1]) {
      const triangle = outline([[-1.47, sign * 1.67], [1.47, sign * 1.67], [0, sign * .11]], .07);
      mesh(geometryOf(triangle, .04, .013), M.black, shroud, [0, .94, 0]);
      mesh(geometryOf(triangle, .04, .013), M.black, backplate, [0, -.635, 0]);
    }
    const fins = [], ridges = [];
    for (const sign of [-1, 1]) for (let i = 0; i < 84; i++) {
      const x = .50 + i * .041, d = Math.min(1.59, .12 + (x - .44) * 1.31);
      fins.push({ p: [sign * x, .14, 0], s: [.018, 1.40, d * 2] }); ridges.push({ p: [sign * x, .85, 0], s: [.013, .012, d * 2] });
    }
    inst(cooler, M.fin, fins); inst(cooler, M.edge, ridges);
    // RTX 4090's two rotors are on opposite faces, unlike the thin 5090.
    fan(-2.48, .915, 1.40, 7); fan(2.48, -.60, 1.40, 7, true);
    // Remove fin volume in the upper rotor's shallow recess. The upper fan is
    // visibly above the fins; the reverse rotor reads through the other end.
    box(cooler, [2.91, .13, 2.68], [0, -.18, 0], M.darkMetal, .12);
    for (const z of [-1.15, -.74, -.35, .35, .74, 1.15]) tube(cooler, [[-3.77, -.15, z], [-1.2, -.21, z * .75], [1.2, -.21, z * .75], [3.77, -.15, z]], .084, M.darkMetal);
    text(shroud, 'RTX 4090', 1.18, .17, [.03, .972, 1.23], '#b4b4aa');
    text(shroud, 'GEFORCE RTX', 2.36, .27, [.20, .13, half + .080], '#dddcd4', [0, 0, 0]);
    for (const x of [-4.0, 4.0]) for (const z of [-1.60, 1.60]) screw(shroud, x, .944, z, .037);
    fanAnchor.set(-2.48, .96, 0); coolerAnchor.set(2.47, .86, -.34);
  }

  function passivePCIeCard() {
    const volta = id === 'volta', hopper = id === 'hopper';
    const topY = H / 2 - .03, bottomY = -.49, half = D / 2;
    const panelMat = material({ color: profile.frame, metalness: .95, roughness: hopper ? .27 : .32, roughnessMap: grain, bumpMap: grain, bumpScale: .004, anisotropy: .48, clearcoat: .10 }, true);
    const warmEdge = material({ color: hopper ? '#bbaa79' : '#bab09a', metalness: 1, roughness: .22 });
    // A full-length PCIe PCB. The GPU and HBM are kept together on one
    // interposer, unlike the GDDR packages of the gaming-card implementation.
    box(board, [W - .30, .072, D - .16], [0, -.414, 0], M.pcb, .05);
    boardSurface(W - .36, D - .20, -.376);
    const pw = profile.packageWidth, pd = profile.packageDepth;
    box(cooler, [pw, .055, pd], [0, -.313, 0], M.substrate, .026);
    box(cooler, [pw - .16, .023, pd - .14], [0, -.271, 0], M.darkMetal, .02);
    const dw = volta ? 1.18 : hopper ? 1.33 : 1.18, dd = volta ? 1.08 : hopper ? 1.03 : 1.56;
    box(cooler, [dw, .035, dd], [0, -.242, 0], M.silicon, .012);
    text(cooler, generation.chip, .51, .075, [0, -.220, .10], '#b7b9b1');
    const hbm = volta ? [[-.39,-.78],[.39,-.78],[-.39,.78],[.39,.78]] : hopper ? [[-.76,-.79],[0,-.79],[.76,-.79],[-.76,.79],[0,.79],[.76,.79]] : [[-.98,-.64],[-.98,0],[-.98,.64],[.98,-.64],[.98,0],[.98,.64]];
    hbm.forEach(([x,z], i) => {
      const w = volta ? .55 : hopper ? .59 : .43, d = volta ? .34 : hopper ? .35 : .52;
      for(let layer=0;layer<4;layer++)box(cooler,[w,.011,d],[x,-.272+layer*.012,z],layer%2?M.darkMetal:M.silicon,.006);
      box(cooler,[w,.015,d],[x,-.22,z],M.memory,.008);
      if(i<profile.memory)text(cooler,generation.memoryType,.30,.037,[x,-.208,z],'#85918f');
    });
    // Five active HBM stacks for the 80 GB PCIe cards; the sixth package site
    // is unlabelled to match the reference package outline without adding RAM.
    memoryAnchor.set(hbm[0][0],-.205,hbm[0][1]); dieAnchor.set(0,-.215,0);
    const bank=[],chokes=[],fet=[];
    for(const sign of [-1,1])for(let row=0;row<(volta?9:12);row++){
      const z=-1.20+row*(volta?.30:.219),x=sign*2.11;
      chokes.push({p:[x,-.273,z],s:[.24,.16,.19]});fet.push({p:[x+sign*.35,-.299,z],s:[.20,.09,.16]});
      for(let j=0;j<3;j++)bank.push([x-sign*.25,z+(j-1)*.060,.82]);
      cyl(board,.069,.115,[x+sign*.63,-.278,z],M.edge,20);cyl(board,.056,.004,[x+sign*.63,-.218,z],M.darkMetal,20);
    }
    inst(board,M.darkMetal,chokes);inst(board,M.black,fet);
    for(let i=0;i<200;i++){
      const x=-3.70+(i*0.271)%7.36,z=-1.41+(i*.173)%2.82;
      if(Math.abs(x)<1.48&&Math.abs(z)<1.28||Math.abs(x)>1.80&&Math.abs(x)<2.92)continue;
      bank.push([x,z,.70]);
    }
    caps(board,bank,-.339);
    for(const x of [-pw/2-.10,pw/2+.10])for(const z of [-pd/2-.08,pd/2+.08])screw(board,x,-.34,z,.043);
    // PCI Express edge fingers and mechanical key notch; no SXM socket remains.
    box(board,[3.56,.072,.34],[-.78,-.414,half+.042],M.pcb,.015);
    const fingers=[];for(let i=0;i<52;i++)if(i!==11&&i!==12)fingers.push({p:[-2.50+i*.067,-.372,half+.074],s:[.044,.009,.26]});
    inst(board,M.gold,fingers);
    // V100 PCIe has no external NVLink bridge fingers. A100/H100 have three
    // protected bridge interfaces on the north edge, as shown in their briefs.
    if(!volta)for(let n=0;n<3;n++){
      const x=-2.10+n*1.25;
      box(board,[.86,.055,.26],[x,-.398,-half-.040],M.pcb,.013);
      const contacts=[];for(let i=0;i<16;i++)contacts.push({p:[x-.365+i*.048,-.364,-half-.060],s:[.026,.007,.18]});
      inst(board,M.gold,contacts);
      box(shroud,[.94,.13,.25],[x,-.276,-half-.047],M.black,.027);
      text(shroud,'NVLINK',.57,.064,[x,-.206,-half-.045],'#737c7b');
    }
    // Rear auxiliary power: one CPU 8-pin for V100/A100; H100 uses 12 power
    // contacts plus four sense contacts in its PCIe 16-pin housing.
    const cols=hopper?6:4,powerW=hopper?.87:.76;
    box(board,[.30,.28,powerW],[W/2-.17,-.263,-.72],M.black,.026);
    for(let row=0;row<2;row++)for(let col=0;col<cols;col++){
      const z=-.72-powerW/2+.10+col*(powerW-.20)/(cols-1),y=-.32+row*.119;
      box(board,[.024,.080,.080],[W/2-.009,y,z],M.plastic,.009);
      box(board,[.025,.026,.026],[W/2+.007,y,z],M.gold);
    }
    if(hopper)for(let i=0;i<4;i++)box(board,[.020,.030,.034],[W/2+.010,-.096,-.89+i*.113],M.gold);
    box(board,[.14,.054,.23],[W/2-.14,-.095,-.72],M.black,.017);
    // Closed continuous backplate and the full-height dual-slot I/O bracket.
    // Bracket has only airflow openings and fastening ears, never display ports.
    box(backplate,[W-.07,.042,D-.075],[0,bottomY,0],M.darkMetal,.080);
    for(const x of [-3.76,-2.30,0,2.30,3.76])for(const z of [-1.43,1.43])screw(backplate,x,-.517,z,.032);
    text(backplate,profile.title,2.55,.24,[.40,-.519,.0],'#777f7f',[Math.PI/2,0,0]);
    for(const z of [-half-.03,half+.03])box(board,[.12,H+.10,.115],[-W/2-.075,.005,z],M.darkMetal,.018);
    for(const y of [-H/2-.026,H/2+.026])box(board,[.12,.07,D+.15],[-W/2-.075,y,0],M.darkMetal,.012);
    const grille=[];
    for(let i=0;i<19;i++)grille.push({p:[-W/2-.084,.005,-half+.16+i*(D-.32)/18],s:[.083,H-.11,.022]});
    inst(board,M.darkMetal,grille);
    for(const z of [-half-.13,half+.13]){
      box(board,[.28,.068,.25],[-W/2-.145,.43,z],M.edge,.023);
      const bolt=cyl(board,.071,.012,[-W/2-.153,.473,z],M.darkMetal,20);bolt.rotation.x=0;
    }
    // Longitudinal fin channels live inside the shroud. Only the ends expose
    // the passive heatsink; the broad face is a continuous manufactured panel.
    box(thermal,[W-.45,.09,D-.29],[0,-.164,0],M.edge,.06);
    box(thermal,[pw+.12,.057,pd+.10],[0,-.222,0],volta?M.copper:M.edge,.035);
    const fins=[];for(let i=0;i<77;i++)fins.push({p:[0,.126,-half+.20+i*(D-.4)/76],s:[W-.49,.47,.014]});
    inst(thermal,M.fin,fins);
    for(const z of [-.92,-.36,.36,.92])tube(thermal,[[-3.66,-.08,z],[-1.27,-.16,z*.68],[1.27,-.16,z*.68],[3.66,-.08,z]],.056,volta?M.copper:M.edge);
    // Full uninterrupted broad-side plate, thin metal edge walls and black end
    // collars. This is a low-profile long card, not an open SXM heat exchanger.
    box(shroud,[W-.10,.082,D-.10],[0,topY,0],volta?M.black:panelMat,.086);
    for(const sign of [-1,1])box(shroud,[W-.12,H-.07,.089],[0,-.007,sign*(half-.031)],volta?M.black:panelMat,.033);
    for(const sign of [-1,1]){
      const x=sign*(W/2-.095);
      box(shroud,[.15,.10,D-.03],[x,topY-.008,0],M.black,.028);
      box(shroud,[.15,.071,D-.03],[x,-.447,0],M.black,.022);
      for(const z of [-half+.043,half-.043])box(shroud,[.15,H-.12,.108],[x,.008,z],M.black,.026);
    }
    if(volta){
      // The V100 brief shows the distinctive angular gold rails, four exposed
      // fasteners and inset black TESLA face used by the reference PCIe card.
      for(const sign of [-1,1]){
        const rail=outline([[-3.86,sign*1.54],[-2.72,sign*1.54],[-2.34,sign*1.10],[2.18,sign*1.10],[2.53,sign*1.54],[3.86,sign*1.54],[3.86,sign*1.21],[2.70,sign*1.21],[2.38,sign*.82],[-2.53,sign*.82],[-2.88,sign*1.21],[-3.86,sign*1.21]],.040);
        mesh(geometryOf(rail,.060,.019),panelMat,shroud,[0,topY+.069,0]);
        const ridge=outline([[-3.87,sign*1.56],[3.87,sign*1.56],[3.87,sign*1.62],[-3.87,sign*1.62]],.014);
        mesh(geometryOf(ridge,.029,.009),warmEdge,shroud,[0,topY+.055,0]);
        for(const x of [-2.59,2.45])screw(shroud,x,topY+.119,sign*1.16,.050);
      }
      box(shroud,[6.12,.015,1.47],[.19,topY+.052,0],M.plastic,.035);
      const title=text(shroud,'TESLA',1.10,.27,[-3.27,topY+.073,0],'#c9bd91');title.rotation.z=Math.PI/2;
      text(shroud,'NVIDIA',1.23,.22,[2.72,topY+.120,-1.44],'#d1c6a1');
      text(shroud,'V100',.59,.10,[2.75,topY+.072,.56],'#a7aca6');
      text(shroud,'TESLA V100',2.04,.21,[.31,.022,half+.027],'#bbaa76',[0,0,0]);
    } else {
      // A100 has a champagne broad panel and finely grooved edge strip. H100
      // keeps the long metallic enclosure with darker end pieces and gold face.
      const ribs=[];
      for(let i=0;i<130;i++)ribs.push({p:[-3.79+i*7.58/129,topY+.054,-half+.15],s:[.015,.013,.215]});
      inst(shroud,hopper?warmEdge:M.darkMetal,ribs);
      box(shroud,[W-.35,.020,.090],[0,topY+.053,-half+.295],M.black,.012);
      box(shroud,[W-.21,.021,.260],[0,topY+.053,half-.191],M.black,.027);
      text(shroud,'NVIDIA',1.10,.146,[2.93,topY+.067,half-.19],'#d0d1cb');
      text(shroud,hopper?'H100':'A100',.57,.10,[-3.18,topY+.067,half-.19],'#c7c8c1');
      // Subtle stamped border is geometry, not a large decorative fake vent.
      if(hopper){
        const border=rect(W-.57,D-.64,.09);holeRect(border,0,0,W-.68,D-.76,.060);
        mesh(geometryOf(border,.018,.006),warmEdge,shroud,[0,topY+.055,0]);
        text(shroud,'NVIDIA H100',2.04,.27,[.35,topY+.070,0],'#564b34');
        for(const x of [-3.60,3.60])for(const z of [-1.12,1.12])screw(shroud,x,topY+.075,z,.030);
      } else text(shroud,'NVIDIA A100',1.61,.19,[.40,topY+.054,.23],'#716955');
      text(shroud,hopper?'H100':'A100',.74,.17,[-2.94,.028,half+.027],'#c9c6b7',[0,0,0]);
    }
    for(const x of [-3.84,3.84])for(const z of [-1.43,1.43])screw(shroud,x,topY+.063,z,.031);
    coolerAnchor.set(1.42,.34,.40);
    thermal.userData={component:'passive-pcie-heatsink',airflow:'along-card-length',referenceReconstruction:true};
    shroud.userData={component:'closed-dual-slot-pcie-enclosure',referenceReconstruction:true};
  }

  if (shape === 'pcie-passive') passivePCIeCard();
  else { consumerBoard(); if (shape === 'blower') blowerCard(); else if (shape === 'dual') dualCard(); else flowCard(); }
  let disposed = false;
  const anchors = {
    cooler: { object: shape === 'pcie-passive' ? thermal : cooler, point: coolerAnchor },
    memory: { object: shape === 'pcie-passive' ? cooler : board, point: memoryAnchor },
    die: { object: shape === 'pcie-passive' ? cooler : board, point: dieAnchor },
    board: { object: board, point: new THREE.Vector3(shape === 'pcie-passive' ? 2.3 : -2.1, -.38, 1.1) },
    fan: { object: fans, point: fanAnchor },
    ...(shape === 'pcie-passive' ? {
      thermal: { object: thermal, point: new THREE.Vector3(1.62,.35,.59) },
      shroud: { object: shroud, point: new THREE.Vector3(-1.47,H/2+.075,-.63) },
    } : {}),
  };
  root.userData = { generation: id, shape, visualReconstruction: true, refs: HARDWARE_REFERENCES[id], onboardFans: shape === 'pcie-passive' ? 0 : rotors.length };
  return {
    root, shroud, cooler, fans, board, backplate, ioBracket, thermal: shape === 'pcie-passive' ? thermal : null, rotors, anchors, materials: M,
    shape, bounds: new THREE.Vector3(W / 2 + (shape === 'pcie-passive' ? .31 : .20), Math.max(H / 2 + .18, .65), D / 2 + (shape === 'pcie-passive' ? .27 : .20)),
    metadata: { shape, title: profile.title, references: HARDWARE_REFERENCES[id], visualReconstruction: true, onboardFans: rotors.length, memoryPackages: profile.memory, packageSites: shape === 'pcie-passive' && id !== 'volta' ? 6 : profile.memory, hasEnclosure: shape === 'pcie-passive', thermalAssembly: shape === 'pcie-passive' ? { type: 'dual-slot-passive-pcie-card', basis: profile.title + ' PCIe official product brief', dimensionalModel: false } : null, formFactor: shape === 'pcie-passive' ? 'PCIe FHFL dual-slot' : 'graphics-card', nvlinkConnectors: shape === 'pcie-passive' ? id === 'volta' ? 0 : 3 : undefined, displayOutputs: shape === 'pcie-passive' ? 0 : undefined },
    setOpacity(opacity) {
      for (const mat of materials) {
        const label = mat.isMeshBasicMaterial;
        const transparent = label || opacity < .999;
        if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = true; }
        mat.opacity = opacity; mat.depthWrite = !label && opacity > .35;
      }
    },
    dispose() { if (disposed) return; disposed = true; resources.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); },
  };
}
