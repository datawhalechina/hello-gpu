export const STORY_CHAPTERS = [
  { id: 'form', label: '外观', at: 0 },
  { id: 'layers', label: '散热结构', at: .22 },
  { id: 'board', label: 'PCB 单板', at: .40 },
  { id: 'silicon', label: '芯片封装', at: .58 },
  { id: 'architecture', label: '芯片架构', at: .76 },
  { id: 'sm', label: 'SM 内部', at: .95 },
];

export const STORY_BOUNDARIES = [.15, .31, .49, .67, .86];

export function activeChapter(progress) {
  const index = STORY_BOUNDARIES.findIndex(boundary => progress < boundary);
  return index === -1 ? STORY_CHAPTERS.length - 1 : index;
}

const sceneKnots = [
  [0, 0], [.15, .18], [.22, .26], [.31, .32], [.40, .37],
  [.49, .405], [.58, .49], [.67, .61], [.76, .70],
  [.86, .82], [.95, .93], [1, 1],
];

// Keep the existing package-to-SM choreography while giving the PCB its own beat.
export function toSceneProgress(progress) {
  const value = Math.max(0, Math.min(1, progress));
  for (let index = 1; index < sceneKnots.length; index += 1) {
    const [end, sceneEnd] = sceneKnots[index];
    if (value > end) continue;
    const [start, sceneStart] = sceneKnots[index - 1];
    return sceneStart + (sceneEnd - sceneStart) * (value - start) / (end - start);
  }
  return 1;
}

export const storyChapterIndex = activeChapter;
export const sceneProgress = toSceneProgress;
