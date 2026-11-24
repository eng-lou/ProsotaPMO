import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {build} from 'esbuild'

const {outputFiles}=await build({
  stdin:{contents:`export * from './src/modules/fourD/constructionHost'
    export {readPropKit} from './src/modules/fourD/constructionLayout'
    export {findDeckBearing} from './src/modules/fourD/deckBearing'
    export {buildConstruction} from './src/modules/fourD/constructionGeometry'
    export {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
    export * from 'three'`,resolveDir:process.cwd()},
  bundle:true,write:false,platform:'node',format:'cjs',external:['web-ifc'],define:{'import.meta.env':'{}'},logLevel:'silent',
})
const compiled={exports:{}}
new Function('module','exports','require',outputFiles[0].text)(compiled,compiled.exports,createRequire(import.meta.url))
const t=compiled.exports
const bytes=readFileSync(new URL('../public/models/Prosota_Slab_Formwork_Full.glb',import.meta.url))
const asset=await new t.GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
const kit=t.readPropKit(asset.scene)
const opts={mode:'deck',spacing:1.9,clearance:3.424,autoClearance:true}

function verifyContacts(deck,rings,height) {
  const props=deck.children.find(group=>group.name.endsWith(' - Props'))
  for(const piece of kit) {
    const material=piece.material
    const built=props.children.find(mesh=>mesh.material===material)
    assert.ok(built)
    const pos=built.geometry.attributes.position
    let feet=0
    for(let i=0;i<pos.count;i++) {
      if(Math.abs(pos.getY(i)+height)>.0001) continue
      const point=new t.Vector2(pos.getX(i),pos.getZ(i))
      assert.equal(rings.filter(r=>t.contains(r,point)).length%2,1,'Footplate outside the bearing face')
      feet++
    }
    if(piece.tripod || material.name==='Painted red props') assert.ok(feet>0,'Tripod feet and prop plate must touch the same plane')
  }
}

test('fitted tripods and base plates land inside the supporting IFC slab, including setbacks and holes',async()=>{
  for(const axis of ['y','z']){
    const upper=new t.Mesh(new t.BoxGeometry(11,.3,8))
    upper.position.y=2.85
    const outer=new t.Shape([[-4,-3],[3,-3],[4,-1],[4,3],[-4,3]].map(([x,y])=>new t.Vector2(x,y)))
    outer.holes.push(new t.Path([[-.9,-.8],[-.9,.8],[.9,.8],[.9,-.8]].map(([x,y])=>new t.Vector2(x,y))))
    const lower=new t.Mesh(new t.ExtrudeGeometry(outer,{depth:.2,bevelEnabled:false}).rotateX(-Math.PI/2))
    lower.position.set(.6,-.2,.25)
    lower.rotation.y=.2
    const model=new t.Group()
    model.add(upper,lower)
    model.rotation.set(axis==='z'?Math.PI/2:0,.36,0,'XYZ')
    model.position.set(23,41,-17)
    model.updateWorldMatrix(true,true)
    model.userData.expressIdMeshIndex=new Map([[1,[upper]],[2,[lower]]])
    const handle={object:model,ifcModelID:0,api:{GetLineIDsWithType:()=>({size:()=>2,get:i=>i+1})}}
    const host=t.readConstructionHost('upper',upper,axis)
    const lookup={handle,expressID:1}
    const bearing=await t.findDeckBearing(host,lookup,axis,opts)
    assert.ok(Math.abs(bearing.clearance-2.7)<.00001)
    assert.equal(bearing.bearingSurfaces[0].length,2)
    verifyContacts(t.buildConstruction(host,{...opts,...bearing},kit),bearing.bearingSurfaces[0],2.7)
    assert.equal(await t.findDeckBearing(host,lookup,axis,{...opts,autoClearance:false,clearance:2}),undefined)
  }
})

test('the real tripod fits edges of an isolated slab at the entered height',()=>{
  const host=t.readConstructionHost('Slab',new t.Mesh(new t.BoxGeometry(5,.2,4)),'y')
  verifyContacts(t.buildConstruction(host,opts,kit),host.rings,opts.clearance)
  const tiny=t.readConstructionHost('Strip',new t.Mesh(new t.BoxGeometry(4,.2,.3)),'y')
  assert.throws(()=>t.buildConstruction(tiny,opts,kit),/feet do not fit/)
})
