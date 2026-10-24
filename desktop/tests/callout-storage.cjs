// Uses an isolated local workspace and real packaged backend; never user data.
const { app, BrowserWindow, session } = require('electron')
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const desktop = path.resolve(__dirname, '..'), data = path.join(desktop, '.test-data', 'callout-' + crypto.randomBytes(4).toString('hex'))
const setPath = app.setPath.bind(app); app.setPath = (name, value) => setPath(name, name === 'userData' ? data : value)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.on('browser-window-created', (_, win) => win.showInactive())
let started = false
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest((details, done) => done({ cancel: details.url.startsWith('https:') })))
app.on('web-contents-created', (_, wc) => wc.once('did-finish-load', async () => {
  if (started) return; started = true
  try {
    console.log(await wc.executeJavaScript(`(async () => {
      const check = (v,m) => {if(!v)throw Error(m)};
      const json = async (url,body,method='POST') => {const r=await fetch('/api/v1/'+url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()};
      const project=await json('projects/',{name:'Callout tests'});
      const other=await json('projects/',{name:'Other project'});
      const image=document.createElement('canvas');image.width=64;image.height=64;const ctx=image.getContext('2d');ctx.fillStyle='#f5a800';ctx.fillRect(0,0,64,64);
      const blob=await new Promise(r=>image.toBlob(r,'image/png'));
      const media=await json('annotations/media',{project_id:project.id,name:'badge.png',content_type:'image/png'});
      check((await fetch(media.upload_url,{method:'PUT',body:blob,headers:{'Content-Type':'image/png'}})).ok,'storage PUT');
      await json('annotations/media/'+media.id+'/ready',{});
      const downloaded=await fetch('/api/v1/annotations/media/'+media.id+'/download');check(downloaded.ok&&(await downloaded.blob()).size===blob.size,'download bytes');
      const base={project_id:project.id,kind:'comment',position_x:0,position_y:0,position_z:0,text:'Site welfare',box_shape:'circle',leader_visible:false,callout:{mode:'image',media_id:media.id,width:160,height:100}};
      const annotation=await json('annotations/',base);check(annotation.callout.mode==='image'&&annotation.box_shape==='circle','create roundtrip');
      const invalid=await fetch('/api/v1/annotations/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,project_id:other.id})});check(invalid.status===422,'cross-project media rejected');
      const badType=await fetch('/api/v1/annotations/'+annotation.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({callout:{mode:'video',media_id:media.id}})});check(badType.status===422,'wrong media type rejected');
      await json('annotations/'+annotation.id,{callout:{mode:'icon_text',media_id:media.id,symbol:'A1'},leader_visible:true},'PATCH');
      const stored=await fetch('/api/v1/annotations/?project_id='+project.id).then(r=>r.json());check(stored[0].callout.symbol==='A1'&&stored[0].leader_visible,'saved config');
      const legacy=await json('annotations/',{...base,callout:undefined,box_shape:'rounded'});check(legacy.callout.mode==='text','legacy default');
      const badMedia=await json('annotations/media',{project_id:project.id,name:'bad.png',content_type:'image/png'});
      await fetch(badMedia.upload_url,{method:'PUT',body:'not an image'});const rejected=await fetch('/api/v1/annotations/media/'+badMedia.id+'/ready',{method:'POST'});check(rejected.status===422,'invalid media rejected');
      window.calloutProject=project.id;
      return 'CALLOUT_STORAGE_PASSED: migration, upload/download, create/update/list, project isolation, type checks, legacy defaults';
    })()`))
    const pause = ms => new Promise(r => setTimeout(r, ms))
    wc.reload(); await pause(3000)
    await wc.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.innerText.includes('Callout tests'));if(!b)throw Error('Project missing after reload');b.click() })()`)
    await pause(2500)
    await wc.executeJavaScript(`document.querySelector('a[href="/4d"]').click()`)
    await pause(2500)
    await wc.executeJavaScript(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.innerText==='3D Notations');if(!b)throw Error('Notation toolbar missing');b.click()})()`)
    await pause(500)
    const controls=await wc.executeJavaScript(`({mode:document.querySelector('select[aria-label="Callout content"]')?.value,shape:document.querySelector('select[aria-label="Callout shape"]')?.value,symbol:document.querySelector('input[aria-label="Badge symbol"]')?.value})`)
    if(controls.mode!=='icon_text'||controls.shape!=='circle'||controls.symbol!=='A1')throw Error('Saved callout controls not restored: '+JSON.stringify(controls))
    fs.writeFileSync(path.join(desktop,'../outputs/callout-controls.png'),(await wc.capturePage()).toPNG())
    console.log('CALLOUT_UI_PASSED: saved content, shape and symbol restored after reload')
    fs.writeFileSync(path.join(desktop, '.test-data/callout-result.json'), JSON.stringify({ passed: true, data }))
  } catch (error) { console.error(error); fs.writeFileSync(path.join(desktop, '.test-data/callout-result.json'), JSON.stringify({ passed: false, error: error.message, data })) }
  finally { app.quit() }
}))
setTimeout(() => { if (!started) { console.error('Startup timed out'); app.quit() } }, 150000).unref()
require('../auth.cjs').authenticate = async () => ({ sub:'test|owner', name:'Callout test',email:'test@example.invalid',is_super_user:true })
require('../main.cjs')
