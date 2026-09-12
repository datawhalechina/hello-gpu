import * as THREE from 'three';

// These regions are emitted by the same drawing calls that paint the die/SM
// texture. Raycasting the actual surface yields UVs; gaps never snap to labels.
export function pickMicroRegion(model, view, camera, element, clientX, clientY) {
  const rect = element.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), camera);
  const surface = model.hitSurfaces[view];
  surface.updateWorldMatrix(true, false);
  const hit = ray.intersectObject(surface, false)[0];
  if (!hit?.uv) return null;
  const x = hit.uv.x, y = 1 - hit.uv.y;
  // Later drawings cover earlier ones (SM cells sit inside GPCs).
  return [...model.hitRegions[view]].reverse().find(({ rect: [left, top, width, height] }) => x >= left && x <= left + width && y >= top && y <= top + height) || null;
}

export function regionCorners(model, view, region) {
  const surface = model.hitSurfaces[view];
  const { width, height } = surface.geometry.parameters;
  const [x, y, w, h] = region.rect;
  return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([u,v]) => surface.localToWorld(new THREE.Vector3((u-.5)*width, (.5-v)*height, .002)));
}
