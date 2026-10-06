import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRenderer, defineComponent, nextTick, ref } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'

// Load the actual sources without a browser or build. Only module specifiers are
// rewritten so Node can resolve the Vue SFC's extensionless TypeScript imports.
const root = new URL('../../', import.meta.url)
const vueUrl = import.meta.resolve('vue')
async function moduleUrl(path, replacements = []) {
  let source = await readFile(new URL(path, root), 'utf8')
  for (const [from, to] of replacements) {
    assert.ok(source.includes(from), `missing import ${from} in ${path}`)
    source = source.replace(from, to)
  }
  const { code } = await transformWithEsbuild(source, path, { loader: 'ts', target: 'es2022' })
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const easingUrl = await moduleUrl('docs/components/animation/easing.ts')
const clockUrl = await moduleUrl('docs/components/animation/useSceneClock.ts', [
  ["from 'vue'", `from '${vueUrl}'`], ["from './easing'", `from '${easingUrl}'`]
])
const { useSceneClock } = await import(clockUrl)
const source = await readFile(new URL('docs/components/animation/ScenePlayer.vue', root), 'utf8')
const { descriptor } = parse(source)
let script = compileScript(descriptor, { id: 'scene-player-clock-test', genDefaultAs: 'Player' }).content
script = script.replaceAll("from 'vue'", `from '${vueUrl}'`).replaceAll('from "vue"', `from '${vueUrl}'`).replace("from './useSceneClock'", `from '${clockUrl}'`)
// The real setup/lifecycle/handlers run; rendering DOM and SVG is outside CPU scope.
script += '\nPlayer.render = () => null; export default Player;'
const playerCode = (await transformWithEsbuild(script, 'ScenePlayer.ts', { loader: 'ts', target: 'es2022' })).code
const { default: Player } = await import(`data:text/javascript;base64,${Buffer.from(playerCode).toString('base64')}`)

const renderer = createRenderer({
  createElement: tag => ({ tag, children: [] }),
  createText: text => ({ text }), createComment: text => ({ text }),
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text },
  parentNode: node => node.parent ?? null, nextSibling: () => null,
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
  remove: node => { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node) },
  patchProp: (node, key, _old, value) => { node[key] = value }
})
function unmountOnce(app) {
  let done = false
  return () => { if (!done) { done = true; app.unmount() } }
}
function mountClock(durations = [1000, 1500, 2000]) {
  let clock
  const durationsRef = ref(durations)
  const app = renderer.createApp(defineComponent({
    setup() { clock = useSceneClock(durationsRef); return () => null }
  }))
  app.mount({ children: [] })
  return { clock, durations: durationsRef, unmount: unmountOnce(app) }
}
function mountPlayer(meta = makeMeta()) {
  const app = renderer.createApp(Player, { meta })
  app.mount({ children: [] })
  return { state: app._instance.setupState, instance: app._instance, unmount: unmountOnce(app) }
}
function makeMeta(title = '测试场景') {
  return { title, eyebrow: 'CPU test', viewBox: '0 0 720 400', steps: [
    { label: '输入', title: '输入', narration: '输入未写出', duration: 1000 },
    { label: '运算', title: '运算', narration: '计算结果', duration: 1500 },
    { label: '输出', title: '输出', narration: '写出结果', duration: 2000 }
  ] }
}
function fakePlatform(initialMotion = false) {
  const saved = new Map()
  const replace = (key, value) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  let now = 0, serial = 0
  const raf = new Map(), timers = new Map(), motionListeners = new Set(), visibilityListeners = new Set()
  const motion = {
    matches: initialMotion,
    addEventListener(type, fn) { assert.equal(type, 'change'); motionListeners.add(fn) },
    removeEventListener(type, fn) { assert.equal(type, 'change'); motionListeners.delete(fn) }
  }
  const document = {
    hidden: false,
    addEventListener(type, fn) { assert.equal(type, 'visibilitychange'); visibilityListeners.add(fn) },
    removeEventListener(type, fn) { assert.equal(type, 'visibilitychange'); visibilityListeners.delete(fn) }
  }
  replace('performance', { now: () => now })
  replace('requestAnimationFrame', fn => { const id = ++serial; raf.set(id, fn); return id })
  replace('cancelAnimationFrame', id => raf.delete(id))
  replace('setInterval', fn => { const id = ++serial; timers.set(id, fn); return id })
  replace('clearInterval', id => timers.delete(id))
  replace('window', { matchMedia: () => motion })
  replace('document', document)
  replace('IntersectionObserver', undefined)
  replace('HTMLButtonElement', class FakeButton {})
  return {
    frame(delta = 16) {
      now += delta
      for (const [id, fn] of [...raf]) if (raf.delete(id)) fn(now)
    },
    frames(duration) { for (let elapsed = 0; elapsed < duration; elapsed += 16) this.frame(Math.min(16, duration - elapsed)) },
    watchdog(delta) { now += delta; for (const [id, fn] of [...timers]) if (timers.has(id)) fn() },
    setMotion(matches) { motion.matches = matches; for (const fn of [...motionListeners]) fn() },
    hide() { document.hidden = true; for (const fn of [...visibilityListeners]) fn() },
    get rafCount() { return raf.size }, get timerCount() { return timers.size },
    get listenerCount() { return motionListeners.size + visibilityListeners.size },
    restore() { for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key] }
  }
}
function fixture(t, reducedMotion = false) {
  const platform = fakePlatform(reducedMotion), mounted = []
  t.after(() => { for (const item of mounted.reverse()) item.unmount(); platform.restore() })
  return { platform,
    clock(durations) { const item = mountClock(durations); mounted.push(item); return item },
    player(meta) { const item = mountPlayer(meta); mounted.push(item); return item }
  }
}
function keyEvent(key, extra = {}) {
  return { key, prevented: false, target: { closest: () => null },
    preventDefault() { this.prevented = true }, ...extra }
}

// Node executes these tests sequentially: the fake platform is restored per test.
test('seek cancels an in-flight jump; the stale tween cannot restore its old destination', t => {
  const f = fixture(t), { clock } = f.clock()
  clock.goToStep(2)
  f.platform.frame(120)
  assert.ok(clock.time.value > 0 && clock.time.value < 4499)
  clock.seek(350)
  assert.equal(clock.time.value, 350)
  f.platform.frames(1000)
  assert.equal(clock.time.value, 350)
  assert.equal(clock.playing.value, false)
  assert.equal(f.platform.rafCount + f.platform.timerCount, 0)
})
test('a nearby destination cancels the earlier jump and cleans up both scheduling loops', t => {
  const f = fixture(t), { clock } = f.clock()
  clock.goToStep(2); f.platform.frame(100)
  const target = clock.time.value + 20
  clock.glideTo(target)
  assert.equal(clock.time.value, target)
  assert.equal(f.platform.rafCount + f.platform.timerCount, 0)
  f.platform.frames(1000)
  assert.equal(clock.time.value, target)
})
test('reduced-motion goToStep is immediate and removes a pending normal-motion tween', t => {
  const f = fixture(t), { clock } = f.clock()
  clock.goToStep(2); f.platform.frame(100)
  clock.reducedMotion.value = true
  clock.goToStep(1)
  assert.equal(clock.time.value, 2499)
  assert.equal(clock.stepIndex.value, 1)
  assert.equal(clock.stepLocal.value, 1499)
  assert.equal(f.platform.rafCount + f.platform.timerCount, 0)
  f.platform.frames(1000)
  assert.equal(clock.time.value, 2499)
})
test('seek and step boundaries clamp correctly; jump targets show each step completed', t => {
  const f = fixture(t), { clock } = f.clock()
  assert.deepEqual(clock.starts.value, [0, 1000, 2500])
  assert.deepEqual(clock.stepTargets.value, [999, 2499, 4499])
  for (const [time, index, local] of [[-100, 0, 0], [999, 0, 999], [1000, 1, 0], [2499, 1, 1499], [2500, 2, 0], [99999, 2, 2000]]) {
    clock.seek(time); assert.equal(clock.stepIndex.value, index); assert.equal(clock.stepLocal.value, local)
  }
  clock.reducedMotion.value = true
  clock.goToStep(-10); assert.equal(clock.time.value, 999)
  clock.goToStep(99); assert.equal(clock.time.value, 4499)
})
test('play, pause, resume and end replay keep one loop and never advance after pause', t => {
  const f = fixture(t), { clock } = f.clock()
  clock.play(); clock.play()
  assert.equal(f.platform.rafCount, 1); assert.equal(f.platform.timerCount, 1)
  f.platform.frames(100)
  assert.equal(clock.time.value, 100)
  clock.pause(); f.platform.frames(500)
  assert.equal(clock.time.value, 100)
  assert.equal(f.platform.rafCount + f.platform.timerCount, 0)
  clock.play(); f.platform.frame(100); assert.equal(clock.time.value, 200)
  clock.seek(4490); f.platform.frame(16)
  assert.equal(clock.time.value, 4500); assert.equal(clock.playing.value, false)
  assert.equal(f.platform.rafCount + f.platform.timerCount, 0)
  clock.play(); assert.equal(clock.time.value, 0)
  f.platform.frame(16); assert.equal(clock.time.value, 16)
})
test('play and toggle interrupt jumps without reviving their stale destination', t => {
  const f = fixture(t), { clock } = f.clock()
  clock.goToStep(2); f.platform.frame(120)
  clock.toggle()
  const paused = clock.time.value
  f.platform.frames(800); assert.equal(clock.time.value, paused)
  clock.goToStep(0); f.platform.frame(100)
  const beforePlay = clock.time.value
  clock.play(); f.platform.frame(100)
  assert.equal(clock.time.value, beforePlay + 100)
  assert.equal(clock.playing.value, true)
})
test('watchdog replaces a stalled RAF once, and unmount clears every pending callback', t => {
  const f = fixture(t), mounted = f.clock(), { clock } = mounted
  clock.play(); f.platform.watchdog(300)
  assert.equal(clock.time.value, 250)
  assert.equal(f.platform.rafCount, 1)
  f.platform.frame(16); assert.equal(clock.time.value, 266)
  mounted.unmount()
  assert.equal(f.platform.rafCount + f.platform.timerCount, 0)
  f.platform.frames(1000); assert.equal(clock.time.value, 266)
})
test('two mounted clocks remain independent when one pauses, seeks or unmounts', t => {
  const f = fixture(t), a = f.clock(), b = f.clock([500, 500])
  a.clock.play(); b.clock.play(); f.platform.frame(100)
  assert.equal(a.clock.time.value, 100); assert.equal(b.clock.time.value, 100)
  a.clock.pause(); a.clock.seek(999); f.platform.frame(100)
  assert.equal(a.clock.time.value, 999); assert.equal(b.clock.time.value, 200)
  a.unmount(); f.platform.frame(100)
  assert.equal(b.clock.time.value, 300)
  assert.equal(f.platform.rafCount, 1); assert.equal(f.platform.timerCount, 1)
})
test('actual player scrubbing pauses playback; reduced motion exposes a stable local frame', async t => {
  const f = fixture(t, true), { state } = f.player()
  await nextTick()
  assert.equal(state.clock.time.value, 999)
  state.onScrub({ target: { value: '1100' } })
  assert.equal(state.clock.stepIndex.value, 1)
  assert.equal(state.clock.stepLocal.value, 100)
  assert.equal(state.visibleLocal, 1499)
  f.platform.setMotion(false)
  assert.equal(state.visibleLocal, 100)
  state.manualToggle(); f.platform.frame(100)
  assert.equal(state.clock.playing.value, true)
  state.onScrub({ target: { value: '300' } })
  assert.equal(state.clock.time.value, 300); assert.equal(state.clock.playing.value, false)
  f.platform.frames(500); assert.equal(state.clock.time.value, 300)
})
test('live motion changes settle the current step, pause playback and clean up listeners', async t => {
  const f = fixture(t), mounted = f.player(), { state } = mounted
  await nextTick()
  state.clock.seek(1200); state.manualToggle(); f.platform.frame(100)
  f.platform.setMotion(true)
  assert.equal(state.clock.time.value, 2499)
  assert.equal(state.visibleLocal, 1499)
  assert.equal(state.clock.playing.value, false)
  assert.equal(f.platform.rafCount + f.platform.timerCount, 0)
  assert.equal(f.platform.listenerCount, 2)
  mounted.unmount(); assert.equal(f.platform.listenerCount, 0)
})
test('actual range keyboard supports step arrows and Home/End; editable descendants keep their keys', t => {
  const f = fixture(t, true), { state } = f.player()
  for (const [key, time] of [['End',4499],['ArrowLeft',2499],['Home',999],['ArrowLeft',999],['ArrowRight',2499]]) {
    const event = keyEvent(key); state.onRangeKey(event)
    assert.equal(event.prevented, true); assert.equal(state.clock.time.value, time)
  }
  const modified = keyEvent('Home', { ctrlKey: true }); state.onRangeKey(modified)
  assert.equal(modified.prevented, false); assert.equal(state.clock.time.value, 2499)
  for (const target of ['input','select','textarea','contenteditable']) {
    const event = keyEvent('ArrowRight', { target: { closest: () => target } })
    state.onKeydown(event); assert.equal(event.prevented, false); assert.equal(state.clock.time.value, 2499)
  }
})
test('dynamic titles preserve the current view; duration changes reset and visibility pauses', async t => {
  const f = fixture(t), mounted = f.player(), { state, instance } = mounted
  state.clock.seek(3000); state.manualToggle(); f.platform.frame(100)
  instance.props.meta = makeMeta('另一个场景')
  await nextTick()
  assert.equal(state.clock.time.value, 3100); assert.equal(state.clock.playing.value, true)
  const changed = makeMeta('另一个场景'); changed.steps[0].duration = 1800
  instance.props.meta = changed; await nextTick()
  assert.equal(state.clock.time.value, 1799)
  state.manualToggle(); f.platform.frame(100); f.platform.hide()
  assert.equal(state.clock.playing.value, false)
  assert.equal(f.platform.rafCount + f.platform.timerCount, 0)
})
