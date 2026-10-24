import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { getRealisticVariant } from '../../frontend/src/modules/fourD/realisticMaterials'
import { waterTime, waterOptions } from '../../frontend/src/modules/fourD/WaterSurface'
import { SceneOverlays, loadOverlays } from '../../frontend/src/modules/fourD/SceneOverlays'
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
const renderer = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true})
renderer.setSize(1000,650);document.body.appendChild(renderer.domElement)
renderer.toneMapping=THREE.ACESFilmicToneMapping
const scene=new THREE.Scene();scene.background=new THREE.Color('#9eb7c5')
const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment()).texture
const camera=new THREE.PerspectiveCamera(45,1000/650,.1,1000);camera.position.set(5,4,9);camera.lookAt(0,0,0)
const sun=new THREE.DirectionalLight('white',4);sun.position.set(-4,7,-6);scene.add(sun,new THREE.HemisphereLight('#bedcff','#404d3d',2))
const original=new THREE.MeshStandardMaterial({color:'white'})
const water=new THREE.Mesh(new THREE.PlaneGeometry(30,30),getRealisticVariant(original,14,original.color.clone(),false))
water.rotation.x=-Math.PI/2;scene.add(water)
const bank=new THREE.Mesh(new THREE.BoxGeometry(2,.6,3),new THREE.MeshStandardMaterial({color:'#aaa18a',roughness:.8}));bank.position.set(-4,0,-3);scene.add(bank)
function frame(t:number){waterTime.value=t;renderer.render(scene,camera);const gl=renderer.getContext(),p=new Uint8Array(1000*650*4);gl.readPixels(0,0,1000,650,gl.RGBA,gl.UNSIGNED_BYTE,p);return p}
const difference=(a:Uint8Array,b:Uint8Array)=>a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0)/a.length
const root=document.createElement('div');document.body.prepend(root)
function Controls(){const [value,setValue]=useState(loadOverlays);return <SceneOverlays value={value} disabled={false} onChange={v=>{setValue(v);localStorage.setItem('prosota-scene-overlays',JSON.stringify(v))}}/>}
createRoot(root).render(<Controls/>)
;(window as any).run=async()=>{
 const a=frame(0),b=frame(2),repeat=frame(2)
 if(difference(a,b)<.2)throw Error('Water is static: '+difference(a,b)+' range '+Math.max(...a.slice(0,5000)))
 if(difference(b,repeat)!==0)throw Error('Water export sampling not deterministic')
 waterOptions.value.x=0;const frozenA=frame(0),frozenB=frame(4)
 if(difference(frozenA,frozenB)!==0)throw Error('Speed zero still moves')
 waterOptions.value.z=1;const muddy=frame(0)
 if(difference(muddy,frozenA)<.5)throw Error('Turbidity has no visual effect')
 waterOptions.value.set(1,.45,.25,1);frame(2)
 document.querySelector('button')!.click();await new Promise(r=>setTimeout(r,100))
 ;(document.querySelector('input[aria-label="app all"]') as HTMLInputElement).click();await new Promise(r=>setTimeout(r,100))
 const settings=loadOverlays()
 if(Object.values(settings.app).some(Boolean)||!settings.render.annotations||!settings.render.zones)throw Error('App toggle alters render settings')
 return {motionDifference:difference(a,b),turbidityDifference:difference(muddy,frozenA),overlays:'independent and persisted'}
}
