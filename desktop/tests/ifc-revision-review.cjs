const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '../..')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.whenReady().then(async () => {
  let win
  try {
    const { outputFiles } = await require(path.join(repo, 'frontend/node_modules/esbuild')).build({
      stdin: { resolveDir: path.join(repo, 'frontend'), loader: 'tsx', contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import * as THREE from 'three';
import {api} from './src/lib/api'; import {IfcRevisionDialog} from './src/modules/fourD/IfcRevisionDialog';
const g=new THREE.BoxGeometry(4,.25,3),g2=new THREE.BoxGeometry(5,.25,3);
const mesh=g=>({vertices:Array.from(g.attributes.position.array),faces:Array.from(g.index.array)});
const before={name:'Ground floor wall W-102',type:'IfcWall',area:{m2:12,basis:'Qto_WallBaseQuantities.NetSideArea'},properties:{Dimensions:{Length:4,Height:3}}};
const after={...before,area:{...before.area,m2:15},properties:{Dimensions:{Length:5,Height:3}}};
const review={id:'revision',baseline_name:'Architect Rev A.ifc',name:'Architect Rev B.ifc',status:'review',created_at:'2026-10-26T12:00:00Z',report:{unchanged:248,changes:[{guid:'wall-102',kind:'modified',fields:['geometry','properties'],before,after,assignments:[{id:'link',code:'T-0014',name:'Build ground floor walls',resource_count:2,cost_count:1}]}]}};
api.get=async url=>({data:url.includes('/geometry/')?{before:mesh(g),after:mesh(g2)}:[review]});
api.put=async (url,data)=>{window.saved=data;return {data:{...review,...data}}};
api.post=async (url,data)=>{window.applied=data;return {data:{...review,...data,status:'applied'}}};
window.exported=null;URL.createObjectURL=blob=>{window.exported=blob;return 'blob:fixture'};HTMLAnchorElement.prototype.click=function(){};
createRoot(document.getElementById('root')).render(<IfcRevisionDialog fileId="file" fileName="Architect Rev A.ifc" onClose={()=>{}}/>);
` }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' } })
    win = new BrowserWindow({ width: 1330, height: 1030, show: false, webPreferences: { contextIsolation: true, backgroundThrottling: false } })
    await win.loadFile(path.join(repo, 'desktop/ui/desktop-settings.html'))
    const run = s => win.webContents.executeJavaScript(s), wait = () => new Promise(r => setTimeout(r, 300))
    await run(`document.querySelectorAll('style,link[rel=stylesheet]').forEach(x=>x.remove());document.documentElement.className='dark';document.body.style='background:#101a2e;color:#dae5f4';document.body.innerHTML='<div id="root"></div>';void 0`)
    const assets = path.join(repo, 'desktop/dist/assets')
    await win.webContents.insertCSS(fs.readFileSync(path.join(assets, fs.readdirSync(assets).find(f => f.endsWith('.css'))), 'utf8'))
    await run(outputFiles[0].text); await wait()
    await run(`(()=>{const s=document.querySelector('[aria-label="Saved reviews"]');s.value='revision';s.dispatchEvent(new Event('change',{bubbles:true}));})()`); await wait()
    assert.equal(await run(`document.querySelectorAll('canvas').length`), 1)
    assert.equal(await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply reviewed changes').disabled`), true)
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Reject ·')).click()`); await wait()
    assert.equal(await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply reviewed changes').disabled`), true)
    await run(`(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Retain the approved wall until the revised access width is coordinated.');t.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait()
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save review draft').click()`); await wait()
    assert.equal((await run(`window.saved.decisions['wall-102']`)).action, 'reject')
    assert.equal(await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply reviewed changes').disabled`), false)
    fs.mkdirSync(path.join(repo, 'outputs'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'outputs/ifc-revision-review.png'), (await win.webContents.capturePage()).toPNG())
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Export visual report').click()`); await wait()
    const html = await run(`window.exported.text()`)
    assert.ok(html.includes('data:image/png;base64,')); assert.ok(html.includes('Retain the approved wall'))
    fs.writeFileSync(path.join(repo, 'outputs/ifc-revision-report.html'), html)
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply reviewed changes').click()`); await wait()
    assert.equal((await run(`window.applied.decisions['wall-102']`)).action, 'reject')
    assert.ok((await run('document.body.innerText')).includes('Reload approved model'))
    console.log('PASS: geometry preview, explicit decisions, required rationale, saved draft, illustrated report, applied review state')
  } catch (e) { console.error(e); process.exitCode = 1 } finally { win?.destroy(); app.quit() }
})
