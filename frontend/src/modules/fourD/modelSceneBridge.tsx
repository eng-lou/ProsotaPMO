import { createContext, useContext, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import type { Object3D } from 'three'
import type { IfcModelHandle } from './ifcModel'
import type { UpAxis } from './upAxis'

export interface SharedSceneModel {id:string;name:string;kind:'ifc'|'mesh';sourceUpAxis:UpAxis;object:Object3D}
export interface ModelSceneSnapshot {projectId:string;models:SharedSceneModel[];ifcHandles:IfcModelHandle[];ready:boolean;errors:string[];revision:number}
const ModelSceneContext=createContext<{snapshot:ModelSceneSnapshot|null;publish:Dispatch<SetStateAction<ModelSceneSnapshot|null>>}|null>(null)

// The import viewer owns the models. Other views may render independent
// hierarchies sharing their geometry, but must never move or dispose the source.
export function ModelSceneProvider({children}:{children:ReactNode}){
  const [snapshot,publish]=useState<ModelSceneSnapshot|null>(null)
  return <ModelSceneContext.Provider value={{snapshot,publish}}>{children}</ModelSceneContext.Provider>
}
export function useModelScene(){return useContext(ModelSceneContext)}
