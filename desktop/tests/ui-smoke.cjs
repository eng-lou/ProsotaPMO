// Run with: desktop/node_modules/.bin/electron desktop/tests/ui-smoke.cjs
// No provider credentials or cloud access. Uses an isolated desktop data folder.
const { app, BrowserWindow, Menu, session, shell } = require('electron')
// Test windows can be occluded by the user's active app. Keep compositor
// frames current so capturePage does not return an earlier UI state.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const desktop = path.resolve(__dirname, '..')
const testData = path.join(desktop, '.test-data', `ui-${crypto.randomBytes(4).toString('hex')}`)
fs.mkdirSync(testData, { recursive: true })
const setPath = app.setPath.bind(app)
app.setPath = (name, value) => setPath(name, name === 'userData' ? testData : value)
const errors = []
const captureWarnings = []
let openedReport = ''
const originalOpenPath = shell.openPath.bind(shell)
shell.openPath = async file => {
  if (file.endsWith('.pbip')) { openedReport = file; return '' }
  return originalOpenPath(file)
}
async function capture(wc, name) {
  try {
    await wc.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await new Promise(resolve => setTimeout(resolve, 250))
    const screenshot = await wc.capturePage(undefined, { stayHidden: true, stayAwake: true })
    fs.writeFileSync(path.join(testData, name), screenshot.toPNG())
  } catch (error) { captureWarnings.push(error.message) }
}
let complete = false
// Windows' compositor must paint the native window before capturePage works.
app.on('browser-window-created', (_event, win) => { win.showInactive() })
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const remote = details.url.startsWith('https:') || (details.url.startsWith('http:') && !details.url.startsWith('http://127.0.0.1:'))
    callback({ cancel: remote })
  })
})
app.on('web-contents-created', (_event, wc) => {
  wc.setBackgroundThrottling(false)
  wc.on('console-message', event => {
    if ((event.level === 'error' || event.level === 3) && !event.message.includes('Electron Security Warning')) errors.push(event.message)
  })
  wc.once('did-finish-load', async () => {
    if (complete) return
    complete = true
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    try {
      for (let i = 0; i < 40; i++) {
        if (await wc.executeJavaScript("document.body.innerText.includes('Create')")) break
        await pause(250)
      }
      const initial = await wc.executeJavaScript('document.body.innerText')
      if (initial.includes("Couldn't verify your access") || initial.includes('Sign in')) throw new Error(initial)
      const entitlement = await wc.executeJavaScript(`fetch('/api/v1/users/me').then(r=>r.json())`)
      if (entitlement.is_super_user !== true) throw Error('Verified owner role did not reach the local backend')
      const project = await wc.executeJavaScript(`fetch('/api/v1/projects/', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Desktop UI smoke'})}).then(r=>r.json())`)
      if (!project.id) throw new Error('Project creation failed')
      const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/wall.ifc'), 'utf8')
      await wc.executeJavaScript(`(async () => {
        const json = async (url, body) => {
          const r = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          if (!r.ok) throw Error(await r.text()); return r.json()
        };
        const upload = await json('/api/v1/model3d-files/presign', {name:'Desktop test wall.ifc',content_type:'application/octet-stream'});
        const put = await fetch(upload.upload_url, {method:'PUT',body:${JSON.stringify(fixture)}});
        if (!put.ok) throw Error('Local IFC upload failed');
        await json('/api/v1/model3d-files/', {project_id:${JSON.stringify(project.id)},name:'Desktop test wall.ifc',kind:'ifc',source_up_axis:'z',storage_key:upload.storage_key});
      })()`)
      await wc.reload()
      await pause(3000)
      const clicked = await wc.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('button')].find(b => b.innerText.includes('Desktop UI smoke'));
        button?.click(); return Boolean(button)
      })()`)
      if (!clicked) throw new Error('Saved project is not visible in project selector')
      await pause(4000)
      console.log('Local project opened; capturing dashboard.')
      await capture(wc, 'dashboard.png')
      const body = await wc.executeJavaScript('document.body.innerText')
      if (!body.includes('Desktop UI smoke')) throw new Error('Selected project did not open')
      await wc.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('button')].find(b => b.innerText === 'Open in Power BI');
        if (!button || button.disabled) throw Error('Power BI entry point unavailable'); button.click();
      })()`)
      await pause(1000)
      await wc.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('button')].find(b => b.innerText === 'Build and open');
        if (!button || button.disabled) throw Error('Power BI export unavailable'); button.click();
      })()`)
      for (let i = 0; i < 120 && !openedReport; i++) await pause(500)
      if (!openedReport || !fs.existsSync(openedReport)) throw Error('Power BI report was not generated')
      await capture(wc, 'powerbi-handoff.png')
      await wc.executeJavaScript(`document.querySelector('[role="dialog"] button')?.click()`)
      const profileFixture = await wc.executeJavaScript(`(async () => {
        const post = async (url,body) => { const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if(!r.ok)throw Error(await r.text()); return r.json() };
        const context=await fetch('/api/v1/schedule-variants/context?project_id=${project.id}').then(r=>r.json());
        const profile=await post('/api/v1/animation-profiles/',{project_id:${JSON.stringify(project.id)},name:'Cabin installation'});
        const activity=await post('/api/v1/activities/',{project_id:${JSON.stringify(project.id)},schedule_period_id:context.period.id,task_name:'Install site cabin',duration_hours:80,constraint_type:'ms',constraint_date:'2026-10-01T08:00:00Z'});
        return {profile,activity};
      })()`)
      const fencePath = await wc.executeJavaScript(`fetch('/api/v1/paths/', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:${JSON.stringify(project.id)},name:'12 m fence fixture',points:[{x:0,y:0,z:0},{x:12,y:0,z:0}]})}).then(r=>r.json())`)
      await wc.executeJavaScript(`(() => { const a = document.querySelector('a[href="/4d"]'); if(!a) throw Error('Missing 4D navigation'); a.click() })()`)
      await pause(8000)
      const scene = await wc.executeJavaScript("({canvas:!!document.querySelector('canvas'),text:document.body.innerText})")
      if (!scene.canvas) throw new Error('3D canvas missing: ' + scene.text.slice(-500))
      if (!scene.text.includes('Desktop test wall')) throw new Error('Saved IFC model missing from viewer')
      await wc.executeJavaScript(`(() => {
        const buttons = [...document.querySelectorAll('button')];
        buttons.find(b => b.innerText === 'Select All')?.click()
      })()`)
      await pause(500)
      await wc.executeJavaScript(`(() => {
        [...document.querySelectorAll('button')].find(b => b.innerText === 'Frame Selected')?.click()
      })()`)
      await pause(2000)
      console.log('3D canvas mounted; capturing viewer.')
      await capture(wc, 'viewer.png')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Site Tools').click() })()`)
      await pause(500)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Layout tools').click() })()`)
      await pause(200)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='+ Fence').click() })()`)
      await pause(300)
      await wc.executeJavaScript(`(() => {
        const source = [...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Source path')).querySelector('select');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(source,${JSON.stringify(fencePath.id)}); source.dispatchEvent(new Event('change',{bubbles:true}));
        const gate = [...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Gate opening')).querySelector('input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(gate,'2'); gate.dispatchEvent(new Event('input',{bubbles:true}));
        [...document.querySelectorAll('label')].find(l=>l.textContent.includes('Model coordinates are in metres')).querySelector('input').click();
      })()`)
      await pause(200)
      // The shortcut must activate Paths even when that panel is already open
      // behind Site Tools, and returning must retain the unsaved fence draft.
      for (let attempt = 0; attempt < 2; attempt++) {
        await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Draw / edit a path').click() })()`)
        await pause(250)
        await wc.executeJavaScript(`(() => { const add=[...document.querySelectorAll('button')].find(b=>b.innerText==='+ Point' && b.getClientRects().length); if(!add)throw Error('Draw/edit did not activate Paths'); add.click() })()`)
        await pause(200)
        await wc.executeJavaScript(`(() => { const stop=document.querySelector('button[title="Click in the viewport to add points — click again to stop"]'); if(!stop)throw Error('Path drawing did not start'); stop.click() })()`)
        await capture(wc,'draw-edit-path.png')
        await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].filter(b=>b.innerText==='Site Tools').at(-1).click() })()`)
        await pause(250)
        await wc.executeJavaScript(`(() => {
          const label=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Source path'));
          if(!label || label.querySelector('select').value!==${JSON.stringify(fencePath.id)})throw Error('Path navigation discarded fence draft');
          const gate=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Gate opening')).querySelector('input');
          if(gate.value!=='2')throw Error('Path navigation reset fence dimensions');
        })()`)
      }
      console.log('PASS: Draw/edit activates Paths repeatedly, starts point drawing and preserves unsaved fence settings')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Preview').click() })()`)
      await pause(1200)
      if (!(await wc.executeJavaScript('document.body.innerText')).includes('5 panels')) throw Error('Fence preview did not produce five panels')
      const emptyScene = await wc.executeJavaScript(`fetch('/api/v1/site-scenes/${project.id}').then(r=>r.json())`)
      if (emptyScene.items.length) throw Error('Preview wrote committed scene')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Frame Selected')?.click() })()`)
      await pause(1000)
      await capture(wc, 'site-fence-preview.png')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Save').click() })()`)
      await pause(800)
      const siteSaved = await wc.executeJavaScript(`fetch('/api/v1/site-scenes/${project.id}').then(r=>r.json())`)
      if (siteSaved.items[0]?.layout.panel_count !== 5) throw Error('Fence save failed')
      await wc.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith('Undo')); if(!b || b.disabled) throw Error('Undo unavailable'); b.click() })()`)
      await pause(700)
      if ((await wc.executeJavaScript(`fetch('/api/v1/site-scenes/${project.id}').then(r=>r.json())`)).items.length) throw Error('Fence undo failed')
      await wc.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith('Redo')); if(!b || b.disabled) throw Error('Redo unavailable'); b.click() })()`)
      await pause(700)
      if ((await wc.executeJavaScript(`fetch('/api/v1/site-scenes/${project.id}').then(r=>r.json())`)).items[0]?.id !== siteSaved.items[0].id) throw Error('Fence redo changed identity')
      console.log('PASS: Site Tools UI preview, fixed-module gate, save, undo and redo')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Asset library').click() })()`)
      await pause(300)
      const assetBytes = [...fs.readFileSync(path.join(desktop, 'tests/fixtures/site-cabin.glb'))]
      await wc.executeJavaScript(`(() => { const input=[...document.querySelectorAll('input[type=file]')].find(i=>i.accept.includes('.fbx')); const dt=new DataTransfer(); dt.items.add(new File([new Uint8Array(${JSON.stringify(assetBytes)})],'Reusable cabin.glb',{type:'model/gltf-binary'})); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})) })()`)
      await pause(200)
      await wc.executeJavaScript(`(()=>{[...document.querySelectorAll('button')].find(b=>b.innerText==='Review import').click()})()`)
      for(let n=0;n<50;n++) { if(await wc.executeJavaScript(`!![...document.querySelectorAll('button')].find(b=>b.innerText==='Import checked asset'&&!b.disabled)`)) break; await pause(300) }
      await capture(wc,'asset-import-review.png')
      await wc.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.innerText==='Import checked asset'); if(!b||b.disabled)throw Error('Material check not ready');b.click() })()`)
      for(let n=0;n<50;n++) { if((await wc.executeJavaScript('document.body.innerText')).includes('Place this asset')) break; await pause(300) }
      await pause(1500)
      await capture(wc,'asset-library.png')
      if((await wc.executeJavaScript(`fetch('/api/v1/site-scenes/${project.id}').then(r=>r.json())`)).items.length !== 1) throw Error('Library import placed an object')
      await wc.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.innerText==='Place this asset'); if(!b) throw Error('Asset preview missing'); b.click() })()`)
      await pause(500)
      const canvasBounds=await wc.executeJavaScript(`(() => { const r=document.querySelector('canvas').getBoundingClientRect(); return {x:Math.round(r.left+r.width*.6),y:Math.round(r.top+r.height*.6)} })()`)
      wc.sendInputEvent({type:'mouseMove',...canvasBounds}); await pause(300)
      wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...canvasBounds})
      wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...canvasBounds})
      await pause(1000)
      await wc.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.innerText==='Save'); if(!b || b.disabled) throw Error('Viewport placement did not produce a valid preview'); b.click() })()`)
      await pause(700)
      const assetScene=await wc.executeJavaScript(`fetch('/api/v1/site-scenes/${project.id}').then(r=>r.json())`)
      if(assetScene.items.length!==2 || !assetScene.items.some(i=>i.kind==='asset'&&i.asset_id)) throw Error('Asset placement was not saved')
      await capture(wc,'asset-placed.png')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Reusable cabin.glb').click() })()`)
      await pause(300)
      const originalAsset = assetScene.items.find(i=>i.kind==='asset')
      await wc.executeJavaScript(`(() => { const p=[...document.querySelectorAll('div')].find(d=>d.textContent==='Location'); if(!p)throw Error('Shared transform Location missing'); const input=p.nextElementSibling.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${originalAsset.position.x + 1.5});input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
      await pause(900)
      const movedAsset=await wc.executeJavaScript(`fetch('/api/v1/site-scenes/${project.id}').then(r=>r.json()).then(s=>s.items.find(i=>i.kind==='asset'))`)
      if(Math.abs(movedAsset.position.x-originalAsset.position.x-1.5)>.001)throw Error('Library transform did not persist')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith('Undo')).click() })()`)
      await pause(700)
      const restoredAsset=await wc.executeJavaScript(`fetch('/api/v1/site-scenes/${project.id}').then(r=>r.json()).then(s=>s.items.find(i=>i.kind==='asset'))`)
      if(Math.abs(restoredAsset.position.x-originalAsset.position.x)>.001)throw Error('Library transform undo failed')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Frame Selected').click(); })()`)
      await pause(600)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Deselect All').click(); [...document.querySelectorAll('button')].find(b=>b.innerText==='Box Select').click(); })()`)
      const bounds=await wc.executeJavaScript(`(() => {const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()`)
      const start={x:Math.round(bounds.x+bounds.w*.1),y:Math.round(bounds.y+bounds.h*.3)},end={x:Math.round(bounds.x+bounds.w*.9),y:Math.round(bounds.y+bounds.h*.9)}
      wc.sendInputEvent({type:'mouseMove',...start});await pause(100);wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...start});await pause(100);wc.sendInputEvent({type:'mouseMove',...end});await pause(100);wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...end});await pause(500)
      if(!(await wc.executeJavaScript(`(() => {const el=document.querySelector('canvas');let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];while(f&&!f.memoizedProps?.siteScene)f=f.return;return f?.memoizedProps?.selectedObjectIds.has('site:${originalAsset.id}')})()`)))throw Error('Box selection did not include library asset')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Box Select').click(); })()`)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Reusable cabin.glb').click() })()`)
      await pause(300)
      console.log('PASS: library box selection, transform controls, persisted move and undo')
      await wc.executeJavaScript(`(() => { const field=document.querySelector('input[placeholder^="Link to activity"]'); if(!field)throw Error('Site object has no activity picker'); field.click(); field.focus() })()`)
      await pause(300)
      await wc.executeJavaScript(`(() => { const option=[...document.querySelectorAll('[role=option]')].find(o=>o.innerText.includes('Install site cabin')); if(!option)throw Error('Activity not offered'); option.click() })()`)
      await pause(600)
      let siteLinks=await wc.executeJavaScript(`fetch('/api/v1/model-element-links/?project_id=${project.id}').then(r=>r.json())`)
      if(!siteLinks.some(l=>l.source_kind==='site'&&l.activity_id===profileFixture.activity.id))throw Error('UI did not create site activity link')
      await wc.executeJavaScript(`(() => { const section=[...document.querySelectorAll('section')].find(s=>s.innerText.includes('Activity links & profiles')); const select=section.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(profileFixture.profile.id)}); select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
      await pause(500)
      siteLinks=await wc.executeJavaScript(`fetch('/api/v1/model-element-links/?project_id=${project.id}').then(r=>r.json())`)
      if(!siteLinks.some(l=>l.source_kind==='site'&&l.animation_profile_id===profileFixture.profile.id))throw Error('UI did not persist profile override')
      await capture(wc,'site-activity-profile.png')
      console.log('PASS: existing activity picker and profile assignment persist for a site library instance')
      console.log('PASS: GLB library preview remains separate from scene; direct viewport placement saves a pinned asset instance')
      await wc.executeJavaScript(`(() => {
        const select=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='realistic'));
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'realistic');select.dispatchEvent(new Event('change',{bubbles:true}));
      })()`)
      await pause(700)
      await wc.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.innerText==='Open panel');if(!b)throw Error('Materials launcher missing');b.click() })()`)
      await pause(1000)
      await wc.executeJavaScript(`(() => { const select=document.querySelector('select[aria-label^="Finish for"]');if(!select)throw Error('Library materials are missing');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'brick');select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
      await pause(1200)
      await capture(wc,'asset-material-mapping.png')
      if((await wc.executeJavaScript('document.body.innerText')).includes('Asset unavailable'))throw Error('Material replacement broke asset rendering')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].filter(b=>b.innerText==='Site Tools').at(-1).click(); })()`)
      await pause(250)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Asset library').click() })()`)
      await pause(250)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Reusable cabin.glb') && b.innerText.includes('Ready')).click() })()`)
      await pause(300)
      await wc.executeJavaScript(`(() => { const s=document.querySelector('select[aria-label="Asset type"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'Trees');s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
      await pause(500)
      const tagged=await wc.executeJavaScript(`fetch('/api/v1/site-assets/?project_id=${project.id}').then(r=>r.json())`)
      if(tagged[0]?.category!=='Trees')throw Error('Asset type did not persist')
      await capture(wc,'asset-type.png')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Layout tools').click() })()`)
      await pause(250)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='+ Tree').click() })()`)
      await pause(300)
      if(!(await wc.executeJavaScript('document.body.innerText')).includes('Click a surface to place'))throw Error('Tree button did not use tagged asset')
      const draftName=await wc.executeJavaScript(`[...document.querySelectorAll('label')].find(l=>l.textContent==='Name')?.querySelector('input')?.value`)
      if(draftName!=='Reusable cabin.glb')throw Error('Tree button used placeholder')
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Cancel').click(); })()`)
      await pause(200)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Asset library').click(); })()`)
      await pause(250)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Reusable cabin.glb')&&b.innerText.includes('Ready')).click(); })()`)
      await pause(300)
      await wc.executeJavaScript(`(() => { [...document.querySelectorAll('button')].find(b=>b.innerText==='Remove from library').click(); })()`)
      await pause(500)
      if((await wc.executeJavaScript(`fetch('/api/v1/site-assets/?project_id=${project.id}').then(r=>r.json())`)).length)throw Error('Old import remains in library')
      if((await wc.executeJavaScript(`fetch('/api/v1/site-scenes/${project.id}').then(r=>r.json())`)).items.length!==2)throw Error('Removing import destroyed placed copies')
      await capture(wc,'library-cleared.png')
      console.log('PASS: imported materials can be mapped; type tags drive Tree placement; library removal retains placed instances')
      await wc.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('button')].find(b => b.innerText.includes('⚙ Settings'));
        if (!button) throw Error('Missing in-app Settings'); button.click();
      })()`)
      await pause(1000)
      const settings = BrowserWindow.getAllWindows().find(w => w.webContents !== wc)
      if (!settings) throw new Error('Native AI connection window did not open')
      const masked = await settings.webContents.executeJavaScript(`window.prosotaDesktop.saveSettings({provider:'openai',model:'test-model',openaiKey:'test-key-not-real',googleMapsKey:'maps-test-not-real'})`)
      if (!masked.hasOpenaiKey || masked.openaiKey) throw new Error('Settings exposed an API key')
      if (!masked.hasGoogleMapsKey || masked.googleMapsKey) throw new Error('Settings exposed the Maps key')
      if (fs.readFileSync(path.join(testData, 'connections.encrypted')).includes('test-key-not-real')) throw new Error('Key was stored in plaintext')
      await capture(settings.webContents, 'ai-settings.png')
      await settings.webContents.executeJavaScript(`window.prosotaDesktop.saveSettings({provider:'off',model:'',openaiKey:null,googleMapsKey:null})`)
      if (errors.length) throw new Error(errors.join('\n'))
      fs.writeFileSync(path.join(desktop, '.test-data', 'ui-result.json'), JSON.stringify({ passed: true, testData, captureWarnings }))
      console.log('PASS: Electron opens offline; local project, dashboard, saved IFC viewer and encrypted AI settings work. Capture warnings: ' + JSON.stringify(captureWarnings))
    } catch (error) {
      fs.writeFileSync(path.join(desktop, '.test-data', 'ui-result.json'), JSON.stringify({ passed: false, error: error.message, testData }))
      await capture(wc,'failure.png')
      fs.writeFileSync(path.join(testData,'failure.txt'),await wc.executeJavaScript('document.body.innerText'))
      console.error(error, errors)
    } finally { app.quit() }
  })
})
setTimeout(() => { if (!complete) { console.error('UI startup timeout'); app.quit() } }, 150000).unref()
// Test-only module stub; production main has no bypass flag or offline grant.
require('../auth.cjs').authenticate = async () => ({ sub: 'test|owner', name: 'UI test', email: 'test@example.invalid', is_super_user: true })
require('../main.cjs')

