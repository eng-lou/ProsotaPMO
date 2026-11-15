import { cancelIfcGeometryPreparations, prepareIfcGeometry } from '../../src/modules/fourD/ifcGeometryLoader'
import { buildIfcScene } from '../../src/modules/fourD/ifcGeometryStream'
import { contextDetailGeometry } from '../../src/modules/fourD/useContextDetail'
import { fullDetailGeometry } from '../../src/modules/fourD/contextGeometry'
import * as T from 'three'
import { readIfcGeometryCache, writeIfcGeometryCache } from '../../src/modules/fourD/ifcGeometryCache'

const source=`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('test.ifc','2026-11-15T00:00:00',('Prosota'),('Prosota'),'test','test','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0YvctVUKr0kugbFTf53O9L',$,'Worker test',$,$,$,$,(#2),#10);
#2=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#3,$);
#3=IFCAXIS2PLACEMENT3D(#4,$,$);
#4=IFCCARTESIANPOINT((0.,0.,0.));
#5=IFCDIRECTION((0.,0.,1.));
#10=IFCUNITASSIGNMENT((#11));
#11=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#20=IFCRECTANGLEPROFILEDEF(.AREA.,'Box',$,2.,2.);
#21=IFCEXTRUDEDAREASOLID(#20,#3,#5,3.);
#22=IFCSHAPEREPRESENTATION(#2,'Body','SweptSolid',(#21));
#23=IFCPRODUCTDEFINITIONSHAPE($,$,(#22));
#24=IFCLOCALPLACEMENT($,#3);
#25=IFCBUILDINGELEMENTPROXY('1YvctVUKr0kugbFTf53O9L',$,'Box',$,$,#24,#23,$,.NOTDEFINED.);
ENDSEC;
END-ISO-10303-21;`

export async function run() {
  const first:string[]=[],second:string[]=[],changed:string[]=[]
  const input=new File([source],'same-name.ifc')
  const data=await prepareIfcGeometry(input,p=>first.push(p))
  const cached=await prepareIfcGeometry(input,p=>second.push(p))
  const modified=await prepareIfcGeometry(new File([source.replace('#5,3.);','#5,5.);')],'same-name.ifc'),p=>changed.push(p))
  if(!data||!cached||!modified)throw Error('Worker did not return geometry')
  const scene=await buildIfcScene({} as any,0,'cached',null,cached)
  const geometry=new T.PlaneGeometry(100,100,256,256)
  const coarse=await contextDetailGeometry(geometry)
  const sourceTriangles=geometry.index!.count/3,coarseTriangles=coarse?.index?.count! /3
  const cancelled=prepareIfcGeometry(input).then(()=>false,error=>error.name==='AbortError')
  cancelIfcGeometryPreparations()
  const cancellation=await cancelled
  const storage=Object.getOwnPropertyDescriptor(window,'indexedDB')!
  Object.defineProperty(window,'indexedDB',{configurable:true,get(){throw new Error('Storage disabled')}})
  let storageFallback=false
  try { storageFallback=(await readIfcGeometryCache('missing'))===null && !(await writeIfcGeometryCache('missing',data)) }
  finally { Object.defineProperty(window,'indexedDB',storage) }
  const tooLarge=!(await writeIfcGeometryCache('oversized',{version:1,geometries:[],placements:{length:1400000} as any}))
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('prosota-ifc-geometry-v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('geometry','readwrite');tx.objectStore('geometry').put({version:1,geometries:[{id:1}],placements:[]},'broken');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
  db.close()
  const corruptIgnored=(await readIfcGeometryCache('broken'))===null
  const passed=cancellation && storageFallback && tooLarge && corruptIgnored && data.placements.length>0 && second.includes('Opening saved geometry…') && !changed.includes('Opening saved geometry…')
    && scene.batch?.byExpressId.size===1 && !!coarse && coarseTriangles<sourceTriangles*.85 && fullDetailGeometry(coarse)===geometry
  return {passed,first,second,changed,placements:data.placements.length,shapes:data.geometries.length,sourceTriangles,coarseTriangles,cancellation,storageFallback,tooLarge,corruptIgnored}
}
