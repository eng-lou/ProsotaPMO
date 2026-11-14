import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const { outputFiles } = await build({ entryPoints: ['src/modules/fourD/viewportFrameMetrics.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const { createViewportFrameMetrics, observeViewportRenderer } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))

test('whole-frame metrics aggregate all passes and update phases without idle gaps', () => {
  let clock = 0
  const m = createViewportFrameMetrics(() => clock)
  const frame = () => {
    m.beginFrame()
    m.addPhase('4D', 2); m.addPhase('Site', 1); m.addPhase('Site', .5)
    clock += 4
    let start = m.beginRender(); clock += 2; m.endRender(start, 100, 500000)
    start = m.beginRender(); clock += 1; m.endRender(start, 1, 1)
  }
  m.setActive(true)
  frame(); clock = 16; frame()
  assert.deepEqual(m.take(), {
    frameMs: 16, updatesMs: 4, submitMs: 3, passes: 2, draws: 101, triangles: 500001,
    phases: { '4D': 2, Site: 1.5 },
  })
  m.setActive(false); clock = 1000; frame()
  assert.equal(m.take(), null, 'idle rendering does not accumulate samples')
  m.setActive(true); clock = 2000; frame(); clock = 2020; frame()
  assert.equal(m.take().frameMs, 20, 'time between gestures is excluded')
  assert.equal(m.take(), null, 'published samples are drained')
})

test('renderer observer counts shadows across info resets and post-processing with either autoReset setting', () => {
  for (const autoReset of [true, false]) {
    let clock = 0
    const m = createViewportFrameMetrics(() => clock)
    const info = { autoReset, render: { calls: 5, triangles: 20 }, reset() { this.render.calls = 0; this.render.triangles = 0 } }
    const renderer = { info, render(pass) {
      if (pass === 'scene') {
        this.info.render.calls += 2; this.info.render.triangles += 30; clock += 1
        if (this.info.autoReset) this.info.reset()
        this.info.render.calls += 100; this.info.render.triangles += 900; clock += 2
      } else {
        if (this.info.autoReset) this.info.reset()
        this.info.render.calls++; this.info.render.triangles++; clock++
      }
    } }
    const original = renderer.render, reset = info.reset
    const cleanup = observeViewportRenderer(renderer, m)
    m.setActive(true)
    for (const at of [0, 16]) {
      clock = at; m.beginFrame(); clock += 3
      renderer.render('scene'); renderer.render('postprocess')
    }
    const sample = m.take()
    assert.equal(sample.draws, 103)
    assert.equal(sample.triangles, 931)
    assert.equal(sample.submitMs, 4)
    assert.equal(sample.updatesMs, 3)
    assert.equal(sample.passes, 2)
    assert.equal(info.autoReset, autoReset)
    if (autoReset) assert.deepEqual(info.render, { calls: 1, triangles: 1 }, 'normal Three stats remain unchanged')
    cleanup()
    assert.equal(renderer.render, original); assert.equal(info.reset, reset)
  }
})

test('nested renderer calls are not counted twice', () => {
  let clock = 0
  const m = createViewportFrameMetrics(() => clock)
  const info = { render: { calls: 0, triangles: 0 }, reset() {} }
  const renderer = { info, render(nested = false) {
    info.render.calls++; info.render.triangles += 3; clock++
    if (!nested) this.render(true)
  } }
  const cleanup = observeViewportRenderer(renderer, m)
  m.setActive(true)
  for (const at of [0, 16]) { clock = at; m.beginFrame(); renderer.render() }
  const sample = m.take()
  assert.equal(sample.draws, 2); assert.equal(sample.triangles, 6); assert.equal(sample.submitMs, 2)
  cleanup()
})

test('reset separates navigation from settled-camera samples without disabling collection', () => {
  let clock = 0
  const metrics = createViewportFrameMetrics(() => clock)
  metrics.setActive(true)
  const draw = at => { clock = at; metrics.beginFrame(); clock += 3; const start = metrics.beginRender(); clock += 5; metrics.endRender(start, 20, 200) }
  draw(0); draw(16)
  metrics.reset()
  assert.equal(metrics.isActive(), true)
  assert.equal(metrics.take(), null)
  draw(1000); draw(2000)
  const idle = metrics.take()
  assert.equal(idle.frameMs, 1000)
  assert.equal(idle.updatesMs, 3); assert.equal(idle.submitMs, 5)
})
