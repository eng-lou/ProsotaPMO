import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
const {outputFiles} = await build({
  stdin: {contents: `export {exportLabelScale} from './src/modules/fourD/exportLabels'; export {composeExportFrame} from './src/modules/fourD/exportOverlays'; export {PerspectiveCamera, OrthographicCamera, Vector3} from 'three'`, resolveDir: process.cwd(), loader:'ts'},
  bundle:true,write:false,platform:'node',format:'esm',
})
const {exportLabelScale,composeExportFrame,PerspectiveCamera,OrthographicCamera,Vector3}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const camera=new PerspectiveCamera(35,4/3,.1,10000)
camera.position.set(0,0,300);camera.updateMatrixWorld()
const label={kind:'zone-label',visible:true,worldPos:new Vector3(),text:'Zone',backgroundColor:null,borderColor:null,textColor:'#fff',fontSize:32,borderRadius:0,bold:true,anchor:'center',distanceFactor:12}
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`)
test('distant perspective labels match live Html sizing, including 4K cover-fit',()=>{
  const live=12/(2*Math.tan(35*Math.PI/360)*300)
  near(exportLabelScale(label,camera,1200,900,4096,2160),live*4096/1200)
  const far=camera.clone();far.position.z=600;far.updateMatrixWorld()
  near(exportLabelScale(label,far,1200,900,4096,2160),live*4096/1200/2)
  near(exportLabelScale({...label,localScale:2},camera,1200,900,4096,2160),live*4096/1200*2)
})
test('orthographic labels match Html zoom and screen-size labels retain CSS size',()=>{
  const ortho=new OrthographicCamera(-5,5,5,-5,.1,1000);ortho.zoom=2
  near(exportLabelScale(label,ortho,1000,1000,2000,1000),48)
  near(exportLabelScale({...label,distanceFactor:undefined},camera,1000,1000,2000,1000),2)
})
test('compositor label sizes ignore DPR and report overlay scale, and clip to scene rectangle',()=>{
  const render=(dpr,overlayScale,width=4096,height=2160)=>{
    const fonts=[], clips=[]
    const ctx={save(){},restore(){},beginPath(){},clip(){},rect(...args){clips.push(args)},fillRect(){},drawImage(){},measureText(){return {width:20}},fillText(){fonts.push(this.font)}}
    const rect={x:10,y:20,width,height}
    composeExportFrame(ctx,{totalWidth:width,totalHeight:height,mainViewRect:rect,comparisonViewRects:[]},{
      mainCanvas:{width:1200*dpr,height:900*dpr},mainCssSize:{width:1200,height:900},
      camera,exportLabels:new Map([['zone',label]]),scale:overlayScale,mainViewTitle:'',
    })
    assert.deepEqual(clips,[[10,20,width,height]])
    return Number(fonts[0].match(/([\d.]+)px/)[1])
  }
  near(render(1,1),render(4,2))
  near(render(4,2),render(2,1,2048,1080)*2)
  assert(render(4,2)<10,'distant zone label must not become a large fixed-size export heading')
})
