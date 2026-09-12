import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createHardwareModel } from './hardwareModel.js';
import { createGenerationHardware } from './generationHardware.js';
import * as MicroModels from './microModels.js';
import { toSceneProgress } from './storyTimeline.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function fade(a, b, x) { return 1 - smooth(a, b, x); }
function point(value, fallback = [0, 0.2, 0]) {
  if (value?.isVector3) return value;
  if (Array.isArray(value)) return new THREE.Vector3(...value);
  return new THREE.Vector3(...fallback);
}

/**
 * One continuous camera move, with scroll progress supplied by the DOM story.
 * Normal exploration leaves wheel and vertical touch scrolling native. A
 * short surface click opens details; only explicit inspection captures drags.
 * Screen anchors are projected from the same camera after every render.
 */
export default function CinematicScene({ progressRef, anchorsRef, labelRefs, labelsVisible = true, inspectMode = false, generation, onReady, onError, onFrame, onOpenExplore, exploreTransition = null, reducedMotion }) {
  const containerRef = useRef(null);
  const callbacks = useRef({ onReady, onError, onFrame, onOpenExplore, generation, reducedMotion, labelsVisible, inspectMode, exploreTransition });
  callbacks.current = { onReady, onError, onFrame, onOpenExplore, generation, reducedMotion, labelsVisible, inspectMode, exploreTransition };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    container.dataset.renderer = 'loading';
    container.dataset.generation = generation.id;
    let disposed = false;
    let animationFrame = 0;
    let width = 1;
    let height = 1;
    let isVisible = true;
    let pageVisible = document.visibilityState !== 'hidden';
    let isReady = false;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      container.dataset.renderer = 'unavailable';
      callbacks.current.onError?.();
      return undefined;
    }
    renderer.setClearColor(0x030405, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.03;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', `${generation.card} 三维模型，从硬件结构深入 ${generation.chip} 与 ${generation.smLabel} 逻辑单元`);
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 120);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentScene = new THREE.Scene();
    environmentScene.background = new THREE.Color('#181f25');
    const studioResources = [];
    function softbox(position, scale, intensity, tint = [1, 1, 1]) {
      const geometry = new THREE.PlaneGeometry(...scale);
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...tint.map(c => c * intensity)), side: THREE.DoubleSide, toneMapped: false });
      const panel = new THREE.Mesh(geometry, material);
      panel.position.set(...position); panel.lookAt(0, 0, 0);
      environmentScene.add(panel); studioResources.push(geometry, material);
    }
    softbox([-4, 7, 4], [3.5, 9], 5.5, [0.95, 0.98, 1]);
    softbox([6, 3, -3], [1.8, 10], 7, [1, 0.99, 0.97]);
    softbox([-6, -2, -4], [2, 6], 1.6, [0.76, 0.84, 0.86]);
    softbox([0, -7, 3], [7, 1.4], 2.5, [0.95, 1, 0.97]);
    softbox([-5, 7, -9], [9, 4], 4.5, [0.96, 0.98, 1]);
    softbox([-5, -3, 9], [10, 4], 2.3, [0.94, 0.97, 1]);
    const environment = pmrem.fromScene(environmentScene, 0.02);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.78;
    studioResources.forEach(resource => resource.dispose());
    pmrem.dispose();

    // Broad studio sources produce soft silver edges, dark recesses, and a
    // restrained green rim; they are lights, not painted highlights on a box.
    const key = new THREE.DirectionalLight(0xf2f5ff, 1.25);
    key.position.set(-3, 8, 6); scene.add(key);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 6, bottom: -6, near: 0.1, far: 30 });
    key.shadow.bias = -0.00025;
    key.shadow.normalBias = 0.016;
    const rim = new THREE.DirectionalLight(0xe6edee, 2.1);
    rim.position.set(7, 4, -5); scene.add(rim);
    const fill = new THREE.DirectionalLight(0x91a7a5, 0.52);
    fill.position.set(-8, 1, -2); scene.add(fill);
    const green = new THREE.DirectionalLight(0xc8d7cf, 0.22);
    green.position.set(3, -1, -7); scene.add(green);
    scene.add(new THREE.HemisphereLight(0xc2d0d7, 0x070909, 0.12));

    const rig = new THREE.Group(); scene.add(rig);
    const blackwell = generation.id === 'blackwell';
    const hardware = blackwell ? createHardwareModel() : createGenerationHardware(generation);
    const passive = hardware.shape === 'pcie-passive';
    container.dataset.hardwareShape = blackwell ? 'blackwell-fe' : hardware.shape;
    container.dataset.onboardFans = String(hardware.rotors.length);
    container.dataset.thermalAssembly = String(Boolean(hardware.thermal));
    // Cache local corners once; fit the moving layers without walking every mesh.
    const assemblyExtents = hardware.root.children.map(group => ({
      group, box: new THREE.Box3().setFromObject(group),
    })).filter(({box}) => !box.isEmpty());
    const assemblyCenter = new THREE.Vector3();
    const assemblyBox = new THREE.Box3();
    const boardBox = new THREE.Box3();
    const boardCenter = new THREE.Vector3();
    const assemblyCorner = new THREE.Vector3();
    const assemblyCorners = assemblyExtents.flatMap(({ group, box }) =>
      [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => ({
        group, local: new THREE.Vector3(x < 0 ? box.min.x : box.max.x, y < 0 ? box.min.y : box.max.y, z < 0 ? box.min.z : box.max.z), posed: new THREE.Vector3(),
      })))),
    );
    rig.add(hardware.root);
    hardware.root.traverse(object => {
      if (object.isMesh && !object.material?.transparent) {
        object.castShadow = true; object.receiveShadow = true;
      }
    });
    const buildMicro = MicroModels.createMicroModels || MicroModels.buildMicroModels;
    const micro = buildMicro(generation);
    if (micro.profile) {
      container.dataset.unitCores = String(micro.profile.cores);
      container.dataset.tensorCores = String(micro.profile.tensor);
      container.dataset.rtCores = String(micro.profile.rt);
      container.dataset.hbmStacks = String(micro.profile.hbm || 0);
    }
    // Each stage fades independently, including materials that the model
    // builder originally shares between the package and SM.
    const smClones = new Map();
    micro.sm.traverse(child => {
      if (!child.material) return;
      const clone = material => {
        if (!smClones.has(material)) smClones.set(material, material.clone());
        return smClones.get(material);
      };
      child.material = Array.isArray(child.material) ? child.material.map(clone) : clone(child.material);
    });
    rig.add(micro.chip, micro.sm);
    micro.chip.visible = false; micro.sm.visible = false;
    const chipAnchors = micro.chipAnchors || micro.anchors?.chip || {};
    const smAnchors = micro.smAnchors || micro.anchors?.sm || {};
    const chipMaterials = new Map();
    const smMaterials = new Map();
    const packagingMaterials = new Map();
    function collectMaterials(object, target) {
      object.traverse(child => {
        if (!child.material) return;
        for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
          if (!target.has(m)) target.set(m, { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
        }
      });
    }
    collectMaterials(micro.chip, chipMaterials);
    collectMaterials(micro.sm, smMaterials);
    if (micro.packaging) collectMaterials(micro.packaging, packagingMaterials);
    function setOpacity(materials, opacity) {
      for (const [material, original] of materials) {
        const transparent = original.transparent || opacity < 0.999;
        if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
        material.opacity = original.opacity * opacity;
        material.depthWrite = original.depthWrite && opacity > 0.4;
      }
    }

    // Enclosure materials also occur on the PCB. Clone only the retiring
    // layers, so their fade cannot make board-mounted chips disappear.
    const retiringGroups = new Set([hardware.shroud, hardware.fans, passive ? hardware.thermal : hardware.cooler]);
    if (blackwell || generation.id === 'ada') retiringGroups.add(hardware.backplate);
    if (hardware.ioBracket) retiringGroups.add(hardware.ioBracket);
    const retiringClones = new Map();
    const retiringMaterials = new Map();
    for (const group of retiringGroups) {
      group.traverse(object => {
        if (!object.material) return;
        const clone = material => {
          if (!retiringClones.has(material)) retiringClones.set(material, material.clone());
          return retiringClones.get(material);
        };
        object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
      });
      collectMaterials(group, retiringMaterials);
    }

    const pointer = new THREE.Vector2();
    const easedPointer = new THREE.Vector2();
    const inspection = new THREE.Vector2();
    const dragStart = new THREE.Vector2();
    let dragging = false;
    let lastInteractive = null;
    let gesture = null;
    const pickRay = new THREE.Raycaster();
    function interactiveView() { const p = toSceneProgress(Number(progressRef?.current) || 0); return p >= .89 ? 'sm' : (p >= .44 && p < .86) ? 'chip' : null; }
    function surfaceAt(event) {
      const view = interactiveView(); if (!view) return null;
      const bounds = renderer.domElement.getBoundingClientRect();
      pickRay.setFromCamera(new THREE.Vector2((event.clientX-bounds.left)/bounds.width*2-1, 1-(event.clientY-bounds.top)/bounds.height*2), camera);
      const surface = micro.hitSurfaces[view]; surface.updateWorldMatrix(true, false);
      return pickRay.intersectObject(surface, false).length ? view : null;
    }
    const cameraPosition = new THREE.Vector3();
    const cameraTarget = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const fitCorner = new THREE.Vector3();
    const modelRotation = new THREE.Euler();
    const fitHalf = new THREE.Vector3();
    const projection = new THREE.Vector3();
    const gpcPoint = point(chipAnchors.gpc, [-0.85, 0.2, -0.75]);
    let lastGeneration;
    let lastTime = performance.now();
    let idleTime = 0;
    let detailTransition = 0;
    let rect = container.getBoundingClientRect();

    function resize() {
      rect = container.getBoundingClientRect();
      width = Math.max(rect.width, 1);
      height = Math.max(rect.height, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 760 ? 1.25 : 1.75));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    function mousemove(event) {
      pointer.set((event.clientX / window.innerWidth - 0.5) * 2, (event.clientY / window.innerHeight - 0.5) * 2);
    }
    window.addEventListener('pointermove', mousemove, { passive: true });
    function pointerDown(event) {
      if (event.button !== 0) return;
      gesture = { x: event.clientX, y: event.clientY, scroll: window.scrollY, moved: false };
      if (!callbacks.current.inspectMode) return;
      dragging = true; dragStart.set(event.clientX, event.clientY);
      renderer.domElement.setPointerCapture(event.pointerId);
    }
    function pointerDrag(event) {
      if (gesture && Math.hypot(event.clientX-gesture.x, event.clientY-gesture.y)>7) gesture.moved=true;
      if (!dragging) {
        const view = surfaceAt(event);
        renderer.domElement.style.cursor = view ? 'zoom-in' : callbacks.current.inspectMode ? 'grab' : 'auto';
        container.dataset.hoverDetail = view || '';
        return;
      }
      inspection.x += (event.clientX - dragStart.x) * 0.004;
      inspection.y = clamp(inspection.y + (event.clientY - dragStart.y) * 0.003, -0.62, 0.6);
      dragStart.set(event.clientX, event.clientY);
    }
    function pointerUp(event) {
      const click = gesture && !gesture.moved && Math.abs(window.scrollY-gesture.scroll)<3;
      dragging = false; gesture = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      if (click) { const view = surfaceAt(event); if (view) callbacks.current.onOpenExplore?.(view); }
    }
    function pointerCancel() { dragging = false; gesture = null; }
    function pointerLeave() { container.dataset.hoverDetail = ''; if (!dragging) gesture=null; }
    function keyDown(event) {
      if ((event.key === 'Enter' || event.key === ' ') && interactiveView()) {
        event.preventDefault(); callbacks.current.onOpenExplore?.(interactiveView());
      }
    }
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerDrag);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerCancel);
    renderer.domElement.addEventListener('lostpointercapture', pointerCancel);
    renderer.domElement.addEventListener('pointerleave', pointerLeave);
    renderer.domElement.addEventListener('keydown', keyDown);
    function visibilityChange() { pageVisible = document.visibilityState !== 'hidden'; if (pageVisible) start(); }
    document.addEventListener('visibilitychange', visibilityChange);
    const observer = new IntersectionObserver(entries => {
      isVisible = entries[0].isIntersecting;
      if (isVisible) start();
    }, { threshold: 0 });
    observer.observe(container);

    function projectedAnchor(object, local, visible) {
      projection.copy(point(local)); object.localToWorld(projection); projection.project(camera);
      return {
        x: rect.left + (projection.x * 0.5 + 0.5) * width,
        y: rect.top + (0.5 - projection.y * 0.5) * height,
        visible: Boolean(visible && projection.z > -1 && projection.z < 1 && Math.abs(projection.x) < 1.12 && Math.abs(projection.y) < 1.12),
      };
    }

    function render(now) {
      animationFrame = 0;
      if (disposed || !isVisible || !pageVisible) return;
      const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
      const storyProgress = clamp(Number(progressRef?.current) || 0, 0, 1);
      const p = toSceneProgress(storyProgress);
      const reduce = motionQuery.matches || callbacks.current.reducedMotion === true;
      const mobile = width < 760;
      const inspecting = callbacks.current.inspectMode;
      const entering = Boolean(callbacks.current.exploreTransition);
      detailTransition = reduce ? Number(entering) : clamp(detailTransition + dt * (entering ? 2.4 : -3.3), 0, 1);
      const detailEase = detailTransition * detailTransition * (3 - 2 * detailTransition);
      container.dataset.transition = entering ? 'entering' : 'stage';
      const clickable = interactiveView(), interactive = `${inspecting}/${clickable}`;
      if (interactive !== lastInteractive) {
        container.style.pointerEvents = inspecting || clickable ? 'auto' : 'none';
        renderer.domElement.style.pointerEvents = inspecting || clickable ? 'auto' : 'none';
        renderer.domElement.style.cursor = inspecting ? 'grab' : 'auto';
        renderer.domElement.style.touchAction = inspecting ? 'none' : 'pan-y';
        renderer.domElement.setAttribute('role', clickable ? 'button' : 'img');
        renderer.domElement.tabIndex = clickable ? 0 : -1;
        renderer.domElement.setAttribute('aria-label', clickable ? `放大查看 ${generation.chip} ${clickable==='sm'?generation.smLabel+' 内部':'芯片架构'}，按 Enter 打开` : `${generation.card} 三维模型`);
        container.dataset.clickableDetail = clickable || '';
        container.dataset.hoverDetail = '';
        lastInteractive = interactive;
      }
      if (!inspecting) {
        if (reduce) inspection.set(0, 0);
        else inspection.multiplyScalar(1 - Math.min(1, dt * 7));
      }
      if (!reduce) idleTime += dt;
      if (reduce) easedPointer.set(0, 0);
      else easedPointer.lerp(pointer, 1 - Math.exp(-dt * 2.0));

      // Scene progress preserves the existing cooling and micro choreography.
      const open = smooth(.18, .255, p);
      const retire = smooth(.29, .375, storyProgress);
      const boardFocus = smooth(.32, .395, storyProgress);
      const transfer = smooth(0.37, 0.49, p);
      const silicon = smooth(0.61, 0.80, p);
      const dive = smooth(0.81, 0.96, p);
      const wholeOpacity = fade(0.405, 0.485, p);
      const overview = 1 - transfer;
      const chipOpacity = smooth(.405,.485,p) * fade(.845,.925,p);
      const smOpacity = smooth(.855,.925,p);

      hardware.root.visible = wholeOpacity > .005;
      hardware.root.position.set(lerp(mobile ? .25 : -2.2 * overview + .25, -0.1, transfer), -0.06 - transfer * 0.4, 0);
      hardware.root.scale.setScalar(lerp(mobile ? 1 : lerp(1,.90,overview), 0.48, transfer));
      hardware.root.rotation.set(blackwell ? lerp(Math.PI - .13, .025, boardFocus) : .025, -.09 + open*.025, -.025);
      // Adjacent physical layers open around the same end of the card. The
      // rotation compensation preserves a short, overlapping fan of layers.
      // The pivot serves the presentation; it does not imply a physical joint.
      const face = blackwell ? -1 : 1;
      const hingeX = (hardware.bounds?.x || 4.5) - .35;
      const shellAngle = -face * open * .12;
      const sinkAngle = -face * open * .04;
      const shellGap = face * (open * 2.55 + retire * 1.6);
      const sinkGap = face * (open * 1.05 + retire * .8);
      const poseLayer = (group, angle, gap, slide = 0, depth = 0) => {
        group.rotation.set(0, 0, angle);
        group.position.set(hingeX*(1-Math.cos(angle)) + slide, gap-hingeX*Math.sin(angle), depth);
      };
      poseLayer(hardware.shroud, shellAngle, shellGap, 0, -face * open * 1.65);
      poseLayer(hardware.fans, shellAngle, shellGap, 0, -face * open * 1.65);
      poseLayer(passive ? hardware.thermal : hardware.cooler, sinkAngle, sinkGap, open*.045, -face * open * .55);
      poseLayer(hardware.board, 0, blackwell ? .24 : 0);
      if (hardware.ioBracket) poseLayer(hardware.ioBracket, 0, blackwell ? .24 : 0);
      // FE triangular lower covers belong to the enclosure. A full rear PCB
      // backplate stays attached to the board on the other PCIe designs.
      if (blackwell || generation.id === 'ada') poseLayer(hardware.backplate, shellAngle, shellGap, 0, -face * open * 1.65);
      else poseLayer(hardware.backplate, 0, 0);
      // On passive cards the misleadingly named cooler group is GPU + HBM.
      // Preserve that complete package as one layer, below the real heatsink.
      if (passive) poseLayer(hardware.cooler, 0, open * .04 * (1-boardFocus));
      for (const group of retiringGroups) group.visible = retire < .999;
      assemblyBox.makeEmpty();
      boardBox.makeEmpty();
      for (const corner of assemblyCorners) {
        corner.posed.copy(corner.local).applyEuler(corner.group.rotation).add(corner.group.position);
        assemblyBox.expandByPoint(corner.posed);
        if (!retiringGroups.has(corner.group)) boardBox.expandByPoint(corner.posed);
      }
      assemblyBox.getCenter(assemblyCenter).multiplyScalar(open);
      boardBox.getCenter(boardCenter);
      assemblyCenter.lerp(boardCenter, boardFocus);
      hardware.setOpacity(wholeOpacity * (1-detailEase*.92));
      setOpacity(retiringMaterials, wholeOpacity * (1-detailEase*.92) * (1-retire));
      container.dataset.boardFocus = String(boardFocus);
      container.dataset.enclosureVisible = String(retire < .999 && hardware.root.visible);
      container.dataset.onboardPackageVisible = String(hardware.root.visible && (passive ? hardware.cooler.visible : hardware.board.visible));
      hardware.rotors.forEach((rotor, index) => { rotor.rotation.y = (reduce ? 0.3 : idleTime * 0.24) * (index ? 1 : -1); });

      const chipScale = lerp(.33, 1.60, transfer) * lerp(1, 1.52, silicon) * lerp(1, 3.6, dive);
      micro.chip.visible = chipOpacity > 0.005;
      micro.chip.scale.setScalar(chipScale);
      micro.chip.position.set(-gpcPoint.x * chipScale * dive, lerp(-.46,-.09,transfer), -gpcPoint.z * chipScale * dive);
      micro.chip.rotation.set(.13 * overview, 0, .018 * overview);
      setOpacity(chipMaterials, chipOpacity);
      setOpacity(packagingMaterials, chipOpacity * fade(0.60, 0.69, p));

      micro.sm.visible = smOpacity > 0.005;
      micro.sm.scale.setScalar(lerp(.42, 1.72, dive));
      micro.sm.position.set(0, .1, 0);
      micro.sm.rotation.set(0, 0, 0);
      setOpacity(smMaterials, smOpacity);
      container.dataset.smVisible = String(micro.sm.visible);
      container.dataset.packageVisible = String(micro.chip.visible);
      container.dataset.assemblyOpen = String(open);
      if (lastGeneration !== callbacks.current.generation) {
        lastGeneration = callbacks.current.generation;
      }
      micro.update?.(lastGeneration, p);

      // The approach becomes gradually more orthographic as the camera enters
      // the silicon. The same physical axes persist across the entire sequence.
      const microscopic = Math.max(silicon, dive);
      cameraPosition.set(
        lerp(4.8, 0.5, microscopic),
        lerp(lerp(lerp(12.2, 10.0, open * overview), 15.5, boardFocus * overview), 12.7, microscopic),
        lerp(lerp(lerp(9.3, 13.0, open * overview), 8.5, boardFocus * overview), 6.2, microscopic),
      );
      // Fit the physical bounds to an editorial viewport, including portrait
      // screens. Distance is derived from BOTH horizontal and vertical FOV.
      const editorial = smooth(0.09, 0.23, p);
      const allowedWidth = mobile ? .91 : lerp(lerp(.74,.58,boardFocus),.64,transfer);
      const allowedHeight = mobile ? 0.37 : lerp(lerp(lerp(.76,.68,editorial), .64, open), .58, transfer);
      forward.copy(cameraPosition).normalize();
      right.crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
      up.crossVectors(forward, right).normalize();
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      function fittedDistance(half, rotation = null) {
        let distance = 0;
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
          fitCorner.set(half.x * x, half.y * y, half.z * z);
          if (rotation) fitCorner.applyEuler(rotation);
          distance = Math.max(distance,
            fitCorner.dot(forward) + Math.abs(fitCorner.dot(right)) / (tangent * camera.aspect * allowedWidth),
            fitCorner.dot(forward) + Math.abs(fitCorner.dot(up)) / (tangent * allowedHeight));
        }
        return distance;
      }
      fitHalf.set(hardware.bounds?.x || 4.50, lerp(hardware.bounds?.y || .87, 1.35, open), (hardware.bounds?.z || 2.02) + (passive ? open*.22 : 0));
      modelRotation.copy(hardware.root.rotation);
      const assembledDistance = fittedDistance(fitHalf, modelRotation);
      const roll = (mobile ? .16 : lerp(lerp(.63, .44, open), .18, boardFocus)) * (1-transfer) * (1-detailEase);
      let expandedDistance = 0;
      let boardDistance = 0;
      for (const corner of assemblyCorners) {
        assemblyCorner.copy(corner.posed).sub(assemblyCenter).applyEuler(modelRotation).multiplyScalar(hardware.root.scale.x).applyAxisAngle(forward, roll);
        const cornerDistance = Math.max(
          assemblyCorner.dot(forward) + Math.abs(assemblyCorner.dot(right)) / (tangent * camera.aspect * allowedWidth),
          assemblyCorner.dot(forward) + Math.abs(assemblyCorner.dot(up)) / (tangent * allowedHeight));
        expandedDistance = Math.max(expandedDistance, cornerDistance);
        if (!retiringGroups.has(corner.group)) boardDistance = Math.max(boardDistance, cornerDistance);
      }
      const cardDistance = lerp(assembledDistance, lerp(expandedDistance, boardDistance, boardFocus) * 1.04, open);
      const packageWeight = fade(.60, .69, p);
      const fittedChipScale = lerp(.33, 1.60, transfer) * lerp(1, 1.52, silicon);
      fitHalf.set(
        lerp(micro.bounds?.dieWidth || 3, micro.bounds?.width || 4, packageWeight) * fittedChipScale / 2 + .08,
        .3,
        lerp(micro.bounds?.dieDepth || 3, micro.bounds?.depth || 4, packageWeight) * fittedChipScale / 2 + .08,
      );
      const chipDistance = fittedDistance(fitHalf);
      fitHalf.set(3.48, 0.24, 2.62);
      const smDistance = fittedDistance(fitHalf);
      const distance = lerp(lerp(cardDistance, chipDistance, transfer), smDistance, dive);
      // The selected silicon stays on screen while its view turns toward the
      // matching orthographic workbench. Scrolling never drives this handoff.
      const normalDistance = distance;
      const targetDirection = new THREE.Vector3(0, 1, .001);
      forward.lerp(targetDirection, detailEase).normalize();
      cameraPosition.copy(forward).multiplyScalar(normalDistance);
      cameraPosition.x += easedPointer.x * (0.18 - microscopic * 0.10);
      cameraPosition.z += easedPointer.y * (0.15 - microscopic * 0.10);
      cameraTarget.set(0, 0, 0);
      camera.position.copy(cameraPosition);
      camera.lookAt(cameraTarget);
      // Product-led composition reserves the left third for short chapter copy.
      const centerX = lerp(mobile ? 0.5 : lerp(0.58, 0.65, editorial), mobile ? .5 : .49, detailEase);
      const centerY = lerp(mobile ? 0.60 : .51, .53, detailEase);
      camera.setViewOffset(width, height, (0.5 - centerX) * width, (0.5 - centerY) * height, width, height);
      rig.position.y = 0;
      rig.setRotationFromAxisAngle(forward, roll);
      rig.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(inspection.y * (1-detailEase), inspection.x * (1-detailEase), 0)));
      // The exterior chapter contains one fully assembled graphics card.
      // The package takes over during the later silicon transition.
      if (!mobile && overview > 0) {
        const inverseRig = rig.quaternion.clone().invert();
        const viewportHeight = 2 * normalDistance * tangent;
        const screenPoint = (x, y) => right.clone().multiplyScalar((x-centerX)*viewportHeight*camera.aspect).addScaledVector(up,(centerY-y)*viewportHeight).applyQuaternion(inverseRig);
        hardware.root.position.lerp(screenPoint(.62,.51), overview);

      }
      hardware.root.position.sub(assemblyCenter.applyEuler(hardware.root.rotation).multiplyScalar(hardware.root.scale.x));
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);

      // Read layout only if sticky position could have changed, rather than
      // installing an independent scroll progress source on this component.
      rect = container.getBoundingClientRect();
      const hardwareDie = projectedAnchor(hardware.anchors.die.object, hardware.anchors.die.point, p > 0.25 && p < 0.48);
      const chipDie = projectedAnchor(micro.chip, chipAnchors.die, p >= 0.48 && p < 0.83);
      const boardLabelsVisible = storyProgress > .32 && storyProgress < .55;
      const anchors = {
        boardGpu: projectedAnchor(hardware.anchors.die.object, hardware.anchors.die.point, boardLabelsVisible),
        boardMemory: projectedAnchor(hardware.anchors.memory.object, hardware.anchors.memory.point, boardLabelsVisible),
        boardPower: projectedAnchor(hardware.board, blackwell ? [1.55,-.39,.53] : [generation.id === 'ada' ? 1.79 : 2.11,-.19,.46], boardLabelsVisible),
        entry: projectedAnchor(p > .88 ? micro.sm : micro.chip, p > .88 ? smAnchors.tensor || smAnchors.cuda : chipAnchors.die, (p >= .44 && p < .86) || p >= .89),
        fan: projectedAnchor(passive ? hardware.anchors.shroud?.object || hardware.shroud : hardware.anchors.fan?.object || hardware.fans, passive ? hardware.anchors.shroud?.point || [0,1,0] : hardware.anchors.fan?.point || [-2.4,-.45,0], p > 0.17 && p < 0.43),
        board: projectedAnchor(hardware.anchors.board?.object || hardware.board, hardware.anchors.board?.point || [-1.05,-.5,.95], p > 0.22 && p < 0.54),
        cooler: projectedAnchor(passive ? hardware.anchors.thermal?.object || hardware.cooler : hardware.anchors.cooler.object, passive ? hardware.anchors.thermal?.point || [0,.5,0] : hardware.anchors.cooler.point, p > 0.12 && p < 0.48),
        memory: projectedAnchor(micro.chip, chipAnchors.memory, generation.category === '数据中心' && p >= .48 && p < .62),
        die: p < 0.48 ? hardwareDie : chipDie,
        gpc: projectedAnchor(micro.chip, gpcPoint, p > 0.61 && p < 0.88),
        substrate: projectedAnchor(micro.chip, chipAnchors.substrate || [-1.65,0.03,0.8], p > 0.47 && p < 0.68),
        l2: projectedAnchor(micro.chip, chipAnchors.l2 || [0,0.15,0.25], p > 0.62 && p < 0.85),
        memoryController: projectedAnchor(micro.chip, [micro.bounds?.dieWidth ? micro.bounds.dieWidth * .44 : 1.1,.16,.1], p > 0.62 && p < 0.85),
        cuda: projectedAnchor(micro.sm, smAnchors.cuda, p > 0.885),
        tensor: projectedAnchor(micro.sm, smAnchors.tensor, p > 0.90),
        rt: projectedAnchor(micro.sm, smAnchors.rt, p > 0.915),
        tma: projectedAnchor(micro.sm, smAnchors.tma, p > .915 && generation.id === 'hopper'),
        cache: projectedAnchor(micro.sm, smAnchors.cache || smAnchors.registers, p > 0.925),
      };
      if (anchorsRef) anchorsRef.current = anchors;
      if (labelRefs?.current) {
        const stages = [smooth(0.17,0.24,p)*fade(.29,.37,storyProgress), smooth(.32,.39,storyProgress)*fade(.48,.55,storyProgress), smooth(0.41,0.49,p)*fade(0.59,0.66,p), smooth(0.61,0.68,p)*fade(0.79,0.85,p), smooth(0.855,0.925,p)];
        for (const [id, element] of Object.entries(labelRefs.current)) {
          if (!element) continue;
          const anchor = anchors[id];
          const stage = Number(element.dataset.stage);
          const alpha = callbacks.current.labelsVisible && anchor?.visible ? stages[stage-1] || 0 : 0;
          element.style.opacity = alpha;
          if (anchor) element.style.transform = `translate3d(${anchor.x - rect.left}px,${anchor.y - rect.top}px,0)`;
        }
      }
      callbacks.current.onFrame?.({
        stage: p < 0.18 ? 'card' : storyProgress < .31 ? 'exploded' : storyProgress < .49 ? 'board' : p < 0.65 ? 'package' : p < 0.85 ? 'die' : 'sm',
        progress: p,
        points: Object.entries(anchors).map(([id, anchor]) => ({ id, x: ((anchor.x - rect.left) / width) * 100, y: ((anchor.y - rect.top) / height) * 100, visible: anchor.visible })),
      });
      if (!isReady) {
        isReady = true;
        container.dataset.renderer = 'ready';
        callbacks.current.onReady?.();
      }
      animationFrame = requestAnimationFrame(render);
    }
    function start() {
      if (!animationFrame && !disposed && pageVisible && isVisible) {
        lastTime = performance.now(); animationFrame = requestAnimationFrame(render);
      }
    }
    start();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect(); observer.disconnect();
      window.removeEventListener('pointermove', mousemove);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerDrag);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      renderer.domElement.removeEventListener('lostpointercapture', pointerCancel);
      renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('keydown', keyDown);
      document.removeEventListener('visibilitychange', visibilityChange);
      hardware.dispose(); micro.dispose?.();
      retiringClones.forEach(material => material.dispose());
      key.shadow.dispose();
      environment.dispose();
      renderer.dispose(); renderer.forceContextLoss();
      renderer.domElement.remove();
      if (anchorsRef) anchorsRef.current = {};
    };
  }, [progressRef, anchorsRef, generation.id]);

  return <div ref={containerRef} className="cinematic-webgl" aria-hidden="false" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
}
