import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildMicroModels } from './cinematic/microModels.js';
import blackwellDieUrl from '../assets/blackwell-official-die-texture.webp';
import ArchivePreviewArt from './ArchivePreviewArt.jsx';

// An architectural display mount, not a reconstruction of a proprietary package
// or foundry mask. The silicon illustration is kept specific to the generation.
function buildDisplay(generation, requestRender) {
  const group = new THREE.Group();
  const ownedTextures = [];
  let disposed = false;
  const micro = generation.id === 'blackwell' ? null : buildMicroModels(generation);
  const logicalTexture = micro?.hitSurfaces.chip.material.map;
  let dieTexture = logicalTexture;
  if (generation.id === 'blackwell') {
    dieTexture = new THREE.TextureLoader().load(blackwellDieUrl, () => {
      if (!disposed) requestRender();
    });
    dieTexture.colorSpace = THREE.SRGBColorSpace;
    dieTexture.anisotropy = 8;
    ownedTextures.push(dieTexture);
  }

  const metal = new THREE.MeshPhysicalMaterial({ color: '#a3afb2', metalness: .7, roughness: .31, clearcoat: .15, clearcoatRoughness: .24 });
  const darkMetal = new THREE.MeshPhysicalMaterial({ color: '#182020', metalness: .92, roughness: .34, clearcoat: .3 });
  const black = new THREE.MeshStandardMaterial({ color: '#070b0b', metalness: .55, roughness: .32 });
  const substrate = new THREE.MeshStandardMaterial({ color: '#16231a', metalness: .3, roughness: .48 });
  const gold = new THREE.MeshStandardMaterial({ color: '#919065', metalness: .92, roughness: .31 });
  const solder = new THREE.MeshStandardMaterial({ color: '#8e9792', metalness: .9, roughness: .32 });
  const insetMetal = new THREE.MeshStandardMaterial({ color: '#34433c', metalness: .78, roughness: .4 });

  const solid = (w, h, d, material, x = 0, y = 0, z = 0, bevel = .035) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, bevel), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const contour = (w, h, thickness, depth, material, z) => {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, -h / 2); shape.lineTo(w / 2, -h / 2);
    shape.lineTo(w / 2, h / 2); shape.lineTo(-w / 2, h / 2); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-w / 2 + thickness, -h / 2 + thickness);
    hole.lineTo(-w / 2 + thickness, h / 2 - thickness);
    hole.lineTo(w / 2 - thickness, h / 2 - thickness);
    hole.lineTo(w / 2 - thickness, -h / 2 + thickness); hole.closePath();
    shape.holes.push(hole);
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .012, bevelThickness: .012 }), material);
    mesh.position.z = z;
    group.add(mesh);
    return mesh;
  };

  const body = solid(3.7, 3.7, .76, black, 0, 0, -.365, .055);
  // A tapered exhibition plinth exposes its right and lower facets rather
  // than turning the whole silicon face away from the reader.
  const bodyVertices = body.geometry.attributes.position;
  for (let i = 0; i < bodyVertices.count; i++) {
    const rear = THREE.MathUtils.clamp((.38 - bodyVertices.getZ(i)) / .76, 0, 1);
    bodyVertices.setX(i, bodyVertices.getX(i) + rear * .3);
  }
  body.geometry.computeVertexNormals();
  contour(3.68, 3.68, .018, .025, gold, -.005);
  contour(3.62, 3.62, .21, .065, darkMetal, .017);
  solid(.205, 3.54, .016, metal, -1.704, 0, .087, .015);
  solid(3.35, .205, .016, metal, -.09, 1.704, .087, .015);
  solid(3.35, .205, .016, darkMetal, -.09, -1.704, .087, .015);
  contour(3.22, 3.22, .083, .052, darkMetal, .052);
  contour(3.075, 3.075, .024, .035, metal, .06);
  solid(3.025, 3.025, .035, substrate, 0, 0, .058, .012);
  // The recessed black border makes the colorful silicon read as a separate,
  // very thin physical surface while keeping the main face front-facing.
  solid(2.74, 2.74, .036, black, 0, 0, .096, .008);
  contour(2.71, 2.71, .022, .006, gold, .115);
  const silicon = new THREE.MeshPhysicalMaterial({
    map: dieTexture, metalness: .06, roughness: .78,
    clearcoat: .035, clearcoatRoughness: .65, iridescence: .015,
    iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 190],
  });
  // Remove the achromatic glare baked into the marketing illustration. This
  // is color grading only; every block and trace remains at its source position.
  if (generation.id === 'blackwell') {
    silicon.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        #ifdef USE_MAP
          vec3 rawDie = diffuseColor.rgb;
          float neutral = min(rawDie.r, min(rawDie.g, rawDie.b));
          float glare = smoothstep(0.09, 0.55, neutral);
          vec3 graded = max(rawDie - vec3(neutral * glare * .86), vec3(0.001));
          graded *= mix(vec3(1.0), vec3(0.9, 1.12, 0.5), glare) * (1.0 - glare * 0.55);
          graded = pow(max(graded, vec3(0.001)), vec3(0.84));
          diffuseColor.rgb = graded * vec3(1.4, 1.5, 0.94);
        #endif
      `);
    };
    silicon.customProgramCacheKey = () => 'archive-blackwell-grade-v2';
  }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.665, 2.665), silicon);
  face.position.z = .132; group.add(face);

  // Small, individually lit package components are instanced; their placement
  // decorates the display mount and is not presented as real routing geometry.
  const components = [];
  const terminals = [];
  for (let i = 0; i < 45; i++) {
    const p = -1.35 + i * .061;
    for (const side of [-1, 1]) {
      if (i % 7 !== 0) components.push([p, side * 1.444, .105, 0]);
      if (i % 6 !== 0) components.push([side * 1.444, p, .105, Math.PI / 2]);
      for (const end of [-1, 1]) {
        if (i % 7 !== 0) terminals.push([p + end * .014, side * 1.444, .107, 0]);
        if (i % 6 !== 0) terminals.push([side * 1.444, p + end * .014, .107, Math.PI / 2]);
      }
    }
  }
  const instance = (size, material, positions) => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), material, positions.length);
    const matrix = new THREE.Object3D();
    positions.forEach(([x, y, z, a], i) => {
      matrix.position.set(x, y, z); matrix.rotation.z = a; matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix);
    });
    group.add(mesh);
  };
  instance([.033, .063, .018], darkMetal, components);
  instance([.008, .063, .02], solder, terminals);

  // Brushed channels and precision-cut notches catch the large soft key light.
  const fineGrooves = [];
  for (let i = 0; i < 64; i++) {
    const x = -.86 + i * .026;
    fineGrooves.push([x, 1.717, .101, 0]);
    fineGrooves.push([x, -1.717, .101, 0]);
  }
  instance([.007, .177, .004], insetMetal, fineGrooves);
  for (const y of [-1.686, 1.686]) {
    solid(.31, .062, .016, black, -.985, y, .107, .005);
    solid(.26, .035, .011, darkMetal, -.985, y - .003, .12, .004);
  }
  for (const side of [-1, 1]) {
    solid(.011, 2.54, .007, insetMetal, side * 1.72, 0, .106, .002);
    solid(.008, 2.48, .006, solder, side * 1.742, 0, .109, .002);
  }
  for (const x of [-1.695, 1.695]) for (const y of [-1.695, 1.695]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(.037, .037, .014, 20), metal);
    screw.rotation.x = Math.PI / 2; screw.position.set(x, y, .11); group.add(screw);
    solid(.045, .007, .005, black, x, y, .12, .001);
    solid(.007, .032, .005, black, x, y, .121, .001);
  }
  for (let k = 0; k < 6; k++) {
    contour(3.686, 3.686, .009, .003, k % 2 ? black : darkMetal, -.06 - k * .052);
  }

  return {
    group,
    dispose() {
      disposed = true;
      const geometries = new Set(), materials = new Set();
      group.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
      ownedTextures.forEach(t => t.dispose()); micro?.dispose();
    },
  };
}

export default function ArchiveChipScene({ generation }) {
  const container = useRef(null);
  useEffect(() => {
    const host = container.current;
    if (!host) return undefined;
    host.dataset.renderState = 'loading';
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      host.dataset.renderState = 'unavailable';
      return undefined;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .85;
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;background:transparent;';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, 1, .1, 30);
    camera.position.set(0, -.5, 8.6); camera.lookAt(0, 0, 0);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, .06); room.dispose(); pmrem.dispose();
    scene.environment = env.texture;
    scene.environmentIntensity = .4;
    scene.environmentRotation.set(0, 1.9, .2);
    scene.add(new THREE.AmbientLight('#adbfbb', .3));
    const key = new THREE.DirectionalLight('#eefaff', 1.35); key.position.set(-4, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight('#c4ddc5', .95); rim.position.set(4, -1, 1); scene.add(rim);
    const fill = new THREE.DirectionalLight('#7caca5', .3); fill.position.set(-3, -3, 3); scene.add(fill);

    let frame = 0, destroyed = false, visible = true;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const rotation = { x: -.66, y: -.212, z: -.14 };
    const target = { x: 0, y: 0 };
    const display = buildDisplay(generation, requestRender);
    display.group.rotation.set(rotation.x, rotation.y, rotation.z);
    display.group.scale.set(.94, 1.16, 1);
    display.group.position.set(.126, .205, 0);
    scene.add(display.group);
    function requestRender() {
      if (!destroyed && visible && !frame && !document.hidden) frame = requestAnimationFrame(render);
    }
    function render() {
      frame = 0;
      if (destroyed || !visible || document.hidden) return;
      const tx = rotation.x + (motion.matches ? 0 : target.y);
      const ty = rotation.y + (motion.matches ? 0 : target.x);
      display.group.rotation.x += (tx - display.group.rotation.x) * .10;
      display.group.rotation.y += (ty - display.group.rotation.y) * .10;
      renderer.render(scene, camera);
      host.dataset.renderState = 'ready';
      if (Math.abs(tx - display.group.rotation.x) + Math.abs(ty - display.group.rotation.y) > .0001) requestRender();
    }
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height;
      // Preserve the silhouette in the wide desktop stage and the narrow mobile
      // stage. The canvas never owns a fixed background or a layout size.
      camera.position.z = camera.aspect < 1 ? 8.6 / camera.aspect : 8.6;
      camera.updateProjectionMatrix(); requestRender();
    };
    const pointer = event => {
      if (motion.matches || event.pointerType === 'touch') return;
      const box = host.getBoundingClientRect();
      target.x = ((event.clientX - box.left) / box.width - .5) * .06;
      target.y = ((event.clientY - box.top) / box.height - .5) * .035;
      requestRender();
    };
    const leave = () => { target.x = 0; target.y = 0; requestRender(); };
    const visibility = () => { if (!document.hidden) requestRender(); };
    const observer = new ResizeObserver(resize); observer.observe(host);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible && frame) { cancelAnimationFrame(frame); frame = 0; }
      if (visible) requestRender();
    }, { rootMargin: '80px' }); intersection.observe(host);
    host.addEventListener('pointermove', pointer); host.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', leave);
    resize();
    return () => {
      destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect();
      host.removeEventListener('pointermove', pointer); host.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', visibility); motion.removeEventListener('change', leave);
      display.dispose(); env.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [generation.id]);
  return <div ref={container} className="archive-chip-scene" role="img" aria-label={`${generation.name} ${generation.chip} 芯片架构展示模型`} style={{ width: '100%', height: '100%', position: 'relative', background: 'transparent' }}><div className="al-model-fallback"><ArchivePreviewArt kind="topology" generation={generation} /></div></div>;
}
