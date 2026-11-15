// Optional read-only benchmark against a local GLB; no model bytes leave this process.
// node tests/browser/context-asset-benchmark.mjs "path/to/tree.glb"
import {readFileSync} from 'node:fs'
import {build} from 'esbuild'
const file=process.argv[2]
if(!file)throw Error('Pass a local GLB filename')
const {outputFiles}=await build({entryPoints:['src/modules/fourD/contextGeometry.ts'],bundle:true,write:false,format:'esm',platform:'node'})
const {simplifyContextGeometry}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const bytes=readFileSync(file)
if(bytes.toString('ascii',0,4)!=='glTF')throw Error('Expected an uncompressed GLB')
let model,bin
for(let offset=12;offset<bytes.length;){const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);const data=bytes.subarray(offset+8,offset+8+length);if(type===0x4e4f534a)model=JSON.parse(data.toString());if(type===0x004e4942)bin=data;offset+=8+length}
if(!model||!bin)throw Error('Missing GLB chunks')
function attribute(id){
 if(id===undefined)return undefined
 const a=model.accessors[id],v=model.bufferViews[a.bufferView]
 if(a.sparse||v.buffer!==0)throw Error('Unsupported sparse/external accessor')
 const size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],width={5121:1,5123:2,5125:4,5126:4}[a.componentType]
 if(!size||!width)throw Error('Unsupported accessor')
 const read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType]
 const result=a.type==='SCALAR'?new Uint32Array(a.count):new Float32Array(a.count*size)
 for(let i=0;i<a.count;i++)for(let c=0;c<size;c++)result[i*size+c]=bin[read]((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*width)+c*width)
 return result
}
const results=[]
for(const mesh of model.meshes||[])for(const primitive of mesh.primitives){
 const position=attribute(primitive.attributes.POSITION),normal=attribute(primitive.attributes.NORMAL),uv=attribute(primitive.attributes.TEXCOORD_0)
 const index=attribute(primitive.indices)||Uint32Array.from({length:position.length/3},(_,i)=>i)
 const before=index.length/3,started=performance.now()
 const supported=(primitive.mode===undefined||primitive.mode===4)&&Object.keys(primitive.attributes).every(k=>['POSITION','NORMAL','TEXCOORD_0'].includes(k))
 const reduced=before>=50000&&supported?simplifyContextGeometry({position,normal,uv,index}):null
 const after=reduced&&reduced.index.length<index.length*.85&&reduced.index.length>0?reduced.index.length/3:before
 results.push({name:mesh.name,before,after,reductionMs:Math.round(performance.now()-started)})
}
console.log(JSON.stringify({results,totalBefore:results.reduce((s,r)=>s+r.before,0),totalAfter:results.reduce((s,r)=>s+r.after,0)}))
