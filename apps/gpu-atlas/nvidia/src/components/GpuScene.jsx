import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Procedural explanatory models. Dimensions and block layouts are illustrative,
// not a reproduction of NVIDIA's mechanical CAD or a silicon floorplan.
const GREEN = '#b6f56a';
const GENERATIONS = {
  tesla: { label: 'TESLA', cores: 8, color: '#a7c990' },
  fermi: { label: 'FERMI', cores: 12, color: '#96c58f' },
  kepler: { label: 'KEPLER', cores: 15, color: '#a1d288' },
  maxwell: { label: 'MAXWELL', cores: 16, color: '#b2d083' },
  pascal: { label: 'PASCAL', cores: 20, color: '#a9d982' },
  volta: { label: 'VOLTA', cores: 24, color: '#b3da8e' },
  turing: { label: 'TURING', cores: 24, color: '#b2e886' },
  ampere: { label: 'AMPERE', cores: 28, color: '#b3ee80' },
  ada: { label: 'ADA LOVELACE', cores: 32, color: '#b3f479' },
  hopper: { label: 'HOPPER', cores: 32, color: '#baff75' },
  blackwell: { label: 'BLACKWELL', cores: 36, color: GREEN },
};

function roundedBox(w, h, d, r = 0.14) {
  r = Math.min(r, w / 2, d / 2);
  const shape = new THREE.Shape();
  const x = -w / 2;
  const z = -d / 2;
  shape.moveTo(x + r, z);
  shape.lineTo(x + w - r, z);
  shape.quadraticCurveTo(x + w, z, x + w, z + r);
  shape.lineTo(x + w, z + d - r);
  shape.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
  shape.lineTo(x + r, z + d);
  shape.quadraticCurveTo(x, z + d, x, z + d - r);
  shape.lineTo(x, z + r);
  shape.quadraticCurveTo(x, z, x + r, z);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: h, bevelEnabled: true, bevelSegments: 2,
    steps: 1, bevelSize: Math.min(0.035, h / 5, d / 5, w / 5), bevelThickness: Math.min(0.03, h / 5),
    curveSegments: 10,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -h / 2, 0);
  return geometry;
}

function buildModels() {
  const materials = {
    metal: new THREE.MeshStandardMaterial({ color: '#939a94', metalness: 0.96, roughness: 0.31 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: '#303831', metalness: 0.86, roughness: 0.37 }),
    fins: new THREE.MeshStandardMaterial({ color: '#69736a', metalness: 0.94, roughness: 0.4 }),
    black: new THREE.MeshStandardMaterial({ color: '#141918', metalness: 0.58, roughness: 0.36 }),
    blade: new THREE.MeshStandardMaterial({ color: '#465248', metalness: 0.84, roughness: 0.28 }),
    pcb: new THREE.MeshStandardMaterial({ color: '#183329', metalness: 0.45, roughness: 0.62 }),
    gold: new THREE.MeshStandardMaterial({ color: '#c3ae69', metalness: 0.85, roughness: 0.3 }),
    silicon: new THREE.MeshStandardMaterial({ color: '#334c46', metalness: 0.78, roughness: 0.2 }),
    green: new THREE.MeshStandardMaterial({ color: GREEN, emissive: '#68ac24', emissiveIntensity: 0.4, metalness: 0.48, roughness: 0.3 }),
    trace: new THREE.MeshStandardMaterial({ color: '#54715b', metalness: 0.68, roughness: 0.45 }),
    violet: new THREE.MeshStandardMaterial({ color: '#a69dd4', metalness: 0.5, roughness: 0.27 }),
    pale: new THREE.MeshStandardMaterial({ color: '#d8dabf', metalness: 0.5, roughness: 0.32 }),
  };
  const resources = new Set();
  const mesh = (geometry, material, parent, position = [0, 0, 0]) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position);
    parent.add(object);
    resources.add(geometry);
    return object;
  };
  const box = (parent, size, pos, mat, radius = 0) => mesh(
    radius ? roundedBox(...size, radius) : new THREE.BoxGeometry(...size),
    mat, parent, pos,
  );
  const cylinder = (parent, radius, height, pos, mat, segments = 64) => mesh(
    new THREE.CylinderGeometry(radius, radius, height, segments), mat, parent, pos,
  );
  const ring = (parent, radius, tube, pos, mat) => {
    const item = mesh(new THREE.TorusGeometry(radius, tube, 8, 96), mat, parent, pos);
    item.rotation.x = Math.PI / 2;
    return item;
  };
  const screw = (parent, x, y, z) => {
    cylinder(parent, 0.064, 0.028, [x, y, z], materials.metal, 12);
    box(parent, [0.07, 0.012, 0.016], [x, y + 0.018, z], materials.black);
  };

  const card = new THREE.Group();
  const board = new THREE.Group();
  const cooler = new THREE.Group();
  const fanLayer = new THREE.Group();
  card.add(board, cooler, fanLayer);
  const dualFans = new THREE.Group();
  const blower = new THREE.Group();
  fanLayer.add(dualFans, blower);
  const rotors = [];
  box(board, [7.64, 0.075, 3.12], [0, -0.43, 0], materials.pcb, 0.12);
  box(board, [7.52, 0.1, 2.99], [0, -0.53, 0], materials.black, 0.12);
  // A real board is much more complex; these components communicate its layers.
  box(board, [1.95, 0.14, 1.85], [-0.05, -0.28, 0], materials.black, 0.06);
  box(board, [1.15, 0.06, 1.08], [-0.05, -0.17, 0], materials.silicon, 0.035);
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 6; i += 1) {
      box(board, [0.38, 0.11, 0.45], [i * 0.71 - 1.78, -0.3, side * 1.09], materials.black, 0.018);
      box(board, [0.27, 0.06, 0.18], [i * 0.71 - 1.78, -0.31, side * 0.75], materials.metal);
    }
  }
  for (let i = 0; i < 16; i += 1) {
    box(board, [0.12, 0.1, 0.3], [2.45 + (i % 4) * 0.27, -0.3, -1.05 + Math.floor(i / 4) * 0.64], materials.darkMetal);
  }
  // PCIe tongue and individual gold fingers.
  box(board, [3.65, 0.06, 0.33], [-0.6, -0.43, 1.65], materials.pcb);
  for (let i = 0; i < 39; i += 1) {
    if (i === 8 || i === 9) continue;
    box(board, [0.055, 0.012, 0.25], [-2.34 + i * 0.09, -0.392, 1.67], materials.gold);
  }
  // Outer satin aluminum shell, inset graphite bed, and densely spaced fins.
  box(cooler, [8.02, 0.89, 3.48], [0, 0.06, 0], materials.darkMetal, 0.23);
  box(cooler, [7.77, 0.95, 3.22], [0, 0.09, 0], materials.black, 0.2);
  for (let i = 0; i < 84; i += 1) {
    box(cooler, [0.027, 0.61, 2.95], [-3.7 + i * 0.089, 0.15, 0], materials.darkMetal);
  }
  box(cooler, [7.75, 0.15, 0.14], [0, 0.57, -1.54], materials.metal, 0.045);
  box(cooler, [7.75, 0.15, 0.14], [0, 0.57, 1.54], materials.metal, 0.045);
  box(cooler, [0.13, 0.16, 3.03], [-3.83, 0.57, 0], materials.metal, 0.035);
  box(cooler, [0.13, 0.16, 3.03], [3.83, 0.57, 0], materials.metal, 0.035);
  // Center bridges make the product silhouette read from a distance.
  const bridgeA = box(cooler, [0.22, 0.14, 3.18], [0, 0.57, 0], materials.metal, 0.04);
  const bridgeB = box(cooler, [0.22, 0.14, 3.18], [0, 0.57, 0], materials.metal, 0.04);
  bridgeA.rotation.y = -0.33;
  bridgeB.rotation.y = 0.33;
  box(cooler, [0.045, 0.04, 1.07], [0, 0.67, 0], materials.green, 0.012);
  // Side edge trim and light slit.
  box(cooler, [5.8, 0.043, 0.045], [0.6, 0.21, 1.758], materials.metal);
  box(cooler, [1.2, 0.027, 0.05], [2.48, 0.29, 1.76], materials.green);
  // Recessed ventilation windows and individual ribs give the side wall depth.
  for (const side of [-1, 1]) {
    box(cooler, [7.31, 0.39, 0.04], [0, -0.015, side * 1.755], materials.black, 0.06);
    for (let i = 0; i < 76; i += 1) {
      box(cooler, [0.024, 0.315, 0.028], [-3.55 + i * 0.0947, -0.015, side * 1.786], materials.fins);
    }
    box(cooler, [7.44, 0.035, 0.042], [0, -0.29, side * 1.746], materials.metal);
  }
  for (const x of [-3.65, 3.65]) for (const z of [-1.35, 1.35]) screw(cooler, x, 0.66, z);
  // I/O bracket and visible sockets.
  box(board, [0.075, 1.2, 3.6], [-4.08, -0.06, 0], materials.metal);
  for (let i = 0; i < 4; i += 1) {
    box(board, [0.03, 0.21, 0.45], [-4.125, -0.12, -1.08 + i * 0.7], materials.black);
    box(board, [0.045, 0.08, 0.31], [-4.147, -0.1, -1.08 + i * 0.7], materials.darkMetal);
  }
  for (let i = 0; i < 10; i += 1) box(board, [0.018, 0.26, 0.055], [-4.128, 0.29, -1.35 + i * 0.29], materials.black);

  function addFan(parent, x, z, radius = 1.4, count = 9) {
    const well = cylinder(parent, radius + 0.05, 0.13, [x, 0.58, z], materials.black);
    ring(parent, radius + 0.022, 0.042, [x, 0.67, z], materials.metal);
    ring(parent, radius - 0.058, 0.022, [x, 0.69, z], materials.darkMetal);
    const rotor = new THREE.Group();
    rotor.position.set(x, 0.675, z);
    parent.add(rotor);
    rotors.push(rotor);
    const outer = radius * 0.94;
    const inner = radius * 0.24;
    const shape = new THREE.Shape();
    shape.moveTo(inner, 0);
    shape.bezierCurveTo(outer * 0.64, -outer * 0.26, outer * 0.85, -outer * 0.37, outer * 0.99, -outer * 0.06);
    shape.quadraticCurveTo(outer * 0.99, outer * 0.11, outer * 0.91, outer * 0.26);
    shape.bezierCurveTo(outer * 0.69, outer * 0.06, outer * 0.43, outer * 0.17, inner * 0.89, inner * 0.52);
    shape.closePath();
    const bladeGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.064, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.016, bevelSegments: 2, steps: 1, curveSegments: 10 });
    bladeGeometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i += 1) {
      const blade = mesh(bladeGeometry, materials.blade, rotor);
      blade.rotation.y = (Math.PI * 2 * i) / count;
    }
    cylinder(rotor, inner * 1.19, 0.12, [0, 0.077, 0], materials.darkMetal);
    cylinder(rotor, inner, 0.02, [0, 0.147, 0], materials.black);
    ring(rotor, inner * 0.92, 0.011, [0, 0.16, 0], materials.metal);
    ring(rotor, inner * 0.65, 0.008, [0, 0.16, 0], materials.darkMetal);
    cylinder(rotor, inner * 0.12, 0.015, [0, 0.16, 0], materials.metal, 16);
    return well;
  }
  addFan(dualFans, -1.94, 0);
  addFan(dualFans, 1.94, 0);
  // Older desktop references use a blower silhouette.
  box(blower, [7.65, 0.16, 3.11], [0, 0.58, 0], materials.black, 0.16);
  box(blower, [4.85, 0.07, 2.85], [-1.28, 0.69, 0], materials.metal, 0.11);
  box(blower, [4.5, 0.075, 2.51], [-1.28, 0.73, 0], materials.darkMetal, 0.09);
  for (let i = 0; i < 24; i += 1) box(blower, [0.035, 0.025, 2.29], [-3.4 + i * 0.184, 0.78, 0], materials.metal);
  addFan(blower, 2.37, 0, 1.17, 15);
  box(blower, [0.072, 0.035, 2.65], [1.09, 0.79, 0], materials.green);

  // Datacenter accelerator: exposed package on a dense SXM-style substrate.
  const module = new THREE.Group();
  const moduleTop = new THREE.Group();
  module.add(moduleTop);
  box(module, [6.15, 0.15, 4.5], [0, -0.34, 0], materials.pcb, 0.17);
  box(module, [6.05, 0.12, 4.4], [0, -0.47, 0], materials.black, 0.14);
  box(moduleTop, [3.25, 0.14, 3.04], [0, -0.11, 0], materials.darkMetal, 0.07);
  box(moduleTop, [1.62, 0.08, 2.13], [0, 0.03, 0], materials.silicon, 0.05);
  for (const x of [-1.1, 1.1]) for (let z = -1; z <= 1; z += 1) {
    box(moduleTop, [0.42, 0.17, 0.52], [x, 0.02, z * 0.75], materials.black, 0.025);
    box(moduleTop, [0.35, 0.018, 0.44], [x, 0.114, z * 0.75], materials.metal, 0.016);
  }
  for (let i = 0; i < 50; i += 1) {
    const x = i < 25 ? -2.23 : 2.23;
    const row = i % 25;
    box(module, [0.26, 0.14, 0.21], [x + ((row % 3) - 1) * 0.32, -0.16, (Math.floor(row / 3) - 4) * 0.43], materials.darkMetal, 0.014);
  }
  for (let i = 0; i < 42; i += 1) {
    box(module, [0.065, 0.035, 0.25], [-2.55 + i * 0.124, -0.23, 2.1], materials.gold);
    box(module, [0.065, 0.035, 0.25], [-2.55 + i * 0.124, -0.23, -2.1], materials.gold);
  }
  for (const x of [-2.79, 2.79]) for (const z of [-1.95, 1.95]) screw(module, x, -0.24, z);

  // Chip package, with separate tile families for compute, cache and interfaces.
  const chip = new THREE.Group();
  const chipTiles = new THREE.Group();
  chip.add(chipTiles);
  box(chip, [5.6, 0.18, 4.7], [0, -0.48, 0], materials.pcb, 0.14);
  box(chip, [4.75, 0.12, 4.06], [0, -0.29, 0], materials.gold, 0.08);
  box(chip, [4.54, 0.13, 3.87], [0, -0.17, 0], materials.silicon, 0.06);
  for (let i = 0; i < 32; i += 1) {
    const x = -2.04 + (i % 8) * 0.58;
    const z = -1.34 + Math.floor(i / 8) * 0.87;
    box(chipTiles, [0.49, 0.125, 0.71], [x, 0.006, z], materials.darkMetal, 0.028);
    for (let j = 0; j < 4; j += 1) {
      box(chipTiles, [0.178, 0.037, 0.267], [x + (j % 2 ? 0.114 : -0.114), 0.09, z + (j < 2 ? -0.17 : 0.17)], materials.green, 0.012);
    }
    box(chipTiles, [0.365, 0.025, 0.045], [x, 0.119, z], materials.gold);
  }
  for (let i = 0; i < 12; i += 1) {
    box(chipTiles, [0.3, 0.135, 0.15], [-1.94 + i * 0.355, 0.036, 1.59], materials.violet, 0.018);
    box(chipTiles, [0.3, 0.135, 0.15], [-1.94 + i * 0.355, 0.036, -1.82], materials.pale, 0.018);
  }
  for (let i = 0; i < 23; i += 1) {
    const x = -2.42 + i * 0.22;
    box(chip, [0.095, 0.05, 0.18], [x, -0.34, 2.16], materials.gold);
    box(chip, [0.095, 0.05, 0.18], [x, -0.34, -2.16], materials.gold);
  }
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 16; i += 1) {
      box(chip, [0.2, 0.045, 0.095], [side * 2.6, -0.34, -1.65 + i * 0.22], materials.gold);
    }
  }

  const sm = new THREE.Group();
  const smLayers = [];
  const smTensorTiles = [];
  const smRtTiles = [];
  box(sm, [5.6, 0.16, 4.4], [0, -0.57, 0], materials.darkMetal, 0.14);
  for (let i = 0; i < 4; i += 1) {
    const tile = new THREE.Group();
    const x = (i % 2 ? 1 : -1) * 1.33;
    const z = (i < 2 ? -1 : 1) * 0.96;
    tile.position.set(x, -0.29, z);
    sm.add(tile);
    smLayers.push(tile);
    box(tile, [2.4, 0.12, 1.61], [0, 0, 0], materials.black, 0.08);
    for (let j = 0; j < 16; j += 1) {
      box(tile, [0.4, 0.13, 0.235], [(j % 4 - 1.5) * 0.53, 0.15, (Math.floor(j / 4) - 1.5) * 0.34], materials.green, 0.025);
    }
    smTensorTiles.push(box(tile, [1.37, 0.12, 0.2], [-0.42, 0.36, -0.59], materials.violet, 0.025));
    smRtTiles.push(box(tile, [0.55, 0.12, 0.2], [0.68, 0.36, -0.59], materials.gold, 0.025));
  }
  box(sm, [4.89, 0.19, 0.28], [0, -0.15, 0], materials.pale, 0.035);
  for (let i = 0; i < 7; i += 1) box(sm, [0.54, 0.12, 0.34], [-2.04 + i * 0.68, -0.24, 1.89], materials.violet, 0.035);

  return { card, module, chip, sm, board, cooler, fanLayer, dualFans, blower, moduleTop, chipTiles, smLayers, smTensorTiles, smRtTiles, rotors, materials, resources };
}

export default function GpuScene({ mode = 'card', exploded = false, autoRotate = true, generation = 'blackwell', resetKey = 0, className = '', onReady }) {
  const mountRef = useRef(null);
  const propsRef = useRef({ mode, exploded, autoRotate, generation, resetKey, onReady });
  propsRef.current = { mode, exploded, autoRotate, generation, resetKey, onReady };
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposeScene;
    const initialize = () => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      setFailed(true);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;outline:none;touch-action:pan-y;';
    renderer.domElement.setAttribute('aria-label', '可拖拽旋转的 GPU 三维示意模型');
    renderer.domElement.setAttribute('role', 'img');
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 100);
    camera.position.set(7.6, 10.2, 13.6);
    camera.lookAt(0, 0, 0);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envTarget = pmrem.fromScene(room, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.87;
    room.dispose();
    pmrem.dispose();
    const ambient = new THREE.AmbientLight('#e6eddd', 0.48);
    scene.add(ambient);
    const key = new THREE.DirectionalLight('#ffffff', 3.25);
    key.position.set(-4, 10, 7);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#d6e9ab', 2.2);
    rim.position.set(4, 4, -6);
    scene.add(rim);
    const fill = new THREE.DirectionalLight('#a5bfc8', 1.15);
    fill.position.set(-7, 1, 0);
    scene.add(fill);

    const all = new THREE.Group();
    all.rotation.y = -0.12;
    scene.add(all);
    const models = buildModels();
    const modelGroups = { card: models.card, module: models.module, chip: models.chip, sm: models.sm };
    Object.values(modelGroups).forEach((group) => { all.add(group); group.visible = false; });
    // Leave ordinary wheel scrolling to the page; pinch (Ctrl-wheel) or Alt-wheel zooms the model.
    const passPageScroll = (event) => { if (!event.ctrlKey && !event.altKey) event.stopImmediatePropagation(); };
    renderer.domElement.addEventListener('wheel', passPageScroll, { capture: true, passive: true });
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enableZoom = true;
    controls.minZoom = 0.65;
    controls.maxZoom = 2;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.11;
    controls.maxPolarAngle = Math.PI * 0.78;
    controls.rotateSpeed = 0.65;
    controls.saveState();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let isVisible = true;
    let stopped = false;
    let frame = 0;
    let lastTime = 0;
    let activeMode = '';
    let lastGeneration = '';
    let lastReset = propsRef.current.resetKey;
    let explodedProgress = 0;
    let reveal = 0;
    let elapsed = 0;
    let dragging = false;
    let interactionTime = -10;
    controls.addEventListener('start', () => { dragging = true; interactionTime = elapsed; });
    controls.addEventListener('end', () => { dragging = false; interactionTime = elapsed; });

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      const aspect = width / height;
      const span = Math.max(5.25, 8.65 / aspect);
      camera.left = -span * aspect / 2;
      camera.right = span * aspect / 2;
      camera.top = span / 2;
      camera.bottom = -span / 2;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    function animate(time) {
      frame = 0;
      if (stopped || !isVisible || document.hidden) return;
      const dt = Math.min((time - (lastTime || time)) / 1000, 0.05);
      lastTime = time;
      elapsed += dt;
      const props = propsRef.current;
      const generationKey = String(props.generation || 'blackwell').toLowerCase();
      const isModule = ['volta', 'ampere', 'hopper'].includes(generationKey);
      const wantedMode = props.mode === 'card' ? (isModule ? 'module' : 'card') : (props.mode === 'sm' ? 'sm' : 'chip');
      if (activeMode !== wantedMode) {
        activeMode = wantedMode;
        Object.entries(modelGroups).forEach(([name, group]) => { group.visible = name === wantedMode; });
        reveal = reducedMotion.matches ? 1 : 0;
      }
      if (lastGeneration !== generationKey) {
        lastGeneration = generationKey;
        const old = ['tesla', 'fermi', 'kepler', 'maxwell', 'pascal'].includes(generationKey);
        models.dualFans.visible = !old;
        models.blower.visible = old;
        models.materials.green.color.set((GENERATIONS[generationKey] || GENERATIONS.blackwell).color);
        models.smTensorTiles.forEach((tile) => { tile.visible = !old; });
        // The selected Ampere reference is A100; Volta/A100/Hopper have no RT cores.
        models.smRtTiles.forEach((tile) => { tile.visible = ['turing', 'ada', 'blackwell'].includes(generationKey); });
      }
      if (lastReset !== props.resetKey) {
        lastReset = props.resetKey;
        controls.reset();
        all.rotation.y = -0.12;
      }
      const easing = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 5);
      explodedProgress += ((props.exploded ? 1 : 0) - explodedProgress) * easing;
      reveal += (1 - reveal) * (reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 8));
      const active = modelGroups[activeMode];
      active.scale.setScalar(0.88 + reveal * 0.12);
      active.position.y = (1 - reveal) * -0.24;
      models.cooler.position.y = explodedProgress * 0.85;
      models.fanLayer.position.y = explodedProgress * 1.65;
      models.board.position.y = explodedProgress * -0.58;
      models.moduleTop.position.y = explodedProgress * 1.07;
      models.chipTiles.position.y = explodedProgress * 0.93;
      models.smLayers.forEach((layer, i) => { layer.position.y = -0.29 + explodedProgress * (0.65 + i * 0.13); });
      if (!reducedMotion.matches) {
        if (props.autoRotate && !dragging && elapsed - interactionTime > 3) {
          all.rotation.y += dt * 0.075;
          all.position.y = Math.sin(elapsed * 0.68) * 0.046;
        }
        models.rotors.forEach((rotor) => { rotor.rotation.y += dt * (props.exploded ? 0.14 : 0.34); });
      }
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    }
    const start = () => { if (!frame && !stopped && isVisible && !document.hidden) { lastTime = 0; frame = requestAnimationFrame(animate); } };
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      if (isVisible) start();
      else if (frame) { cancelAnimationFrame(frame); frame = 0; }
    }, { rootMargin: '80px' });
    intersectionObserver.observe(mount);
    const visibility = () => {
      if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; }
      else start();
    };
    const contextLost = (event) => { event.preventDefault(); setFailed(true); if (frame) cancelAnimationFrame(frame); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    document.addEventListener('visibilitychange', visibility);
    start();
    propsRef.current.onReady?.();

    return () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('wheel', passPageScroll, { capture: true });
      controls.dispose();
      models.resources.forEach((geometry) => geometry.dispose());
      Object.values(models.materials).forEach((material) => material.dispose());
      envTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    };
    // Yield the first paint to text and controls before setting up the GPU renderer.
    const timer = setTimeout(() => { disposeScene = initialize(); }, 180);
    return () => { clearTimeout(timer); disposeScene?.(); };
  }, []);

  return (
    <div className={`gpu-scene ${className}`} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 160 }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, cursor: 'grab', opacity: failed ? 0 : 1 }} />
      {failed && (
        <div role="img" aria-label="GPU 架构模型的静态替代示意" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', gap: 18, textAlign: 'center', color: '#bac6a8' }}>
          <div style={{ width: 210, height: 125, border: '1px solid #7c965e', borderRadius: 12, transform: 'perspective(500px) rotateX(25deg) rotateZ(-15deg)', background: 'repeating-linear-gradient(90deg,#171e17 0 8px,#37462d 9px 10px)', display: 'flex', alignItems: 'center', justifyContent: 'space-evenly', boxShadow: '0 25px 50px #0005' }}>
            {[0, 1].map((i) => <span key={i} style={{ width: 76, height: 76, border: '5px solid #8f9580', borderRadius: '50%', background: 'repeating-conic-gradient(#252f23 0deg 15deg,#69735c 16deg 23deg)' }} />)}
          </div>
          <span style={{ fontSize: 11, letterSpacing: '0.12em', marginTop: 12 }}>当前环境显示静态示意 · 架构资料仍可浏览</span>
        </div>
      )}
    </div>
  );
}
