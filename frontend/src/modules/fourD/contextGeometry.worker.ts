import { simplifyContextGeometry, type ContextGeometryData } from './contextGeometry'
const scope=self as unknown as {onmessage:((event:MessageEvent<ContextGeometryData>)=>void)|null;postMessage(value:unknown,transfer:Transferable[]):void}
scope.onmessage=({data})=>{
  const result=simplifyContextGeometry(data)
  scope.postMessage(result,[result.position.buffer,result.index.buffer,...(result.normal?[result.normal.buffer]:[]),...(result.uv?[result.uv.buffer]:[])] as ArrayBuffer[])
}
