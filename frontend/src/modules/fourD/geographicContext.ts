export type XY = [number, number]
export type MapKind = 'building'|'road'|'rail'|'paving'|'grass'|'water'|'tree'|'wood'
export interface SurfaceFinish { color?: string|null; finish: import('./realisticMaterials').RealisticMapping }
export interface FeatureReplacement { asset_id:string; width:number; depth:number; height:number; yaw:number; anchor:[number,number,number] }
export interface MapFeature {
  id: string; name: string; kind: MapKind; category: string; points: XY[]; holes: XY[][]
  height: number; height_basis: 'mapped height'|'mapped floors'|'estimated'|'user'
  width: number; roof: 'flat'|'gabled'|'hipped'|'industrial'; roof_basis: 'mapped'|'estimated'|'user'
  color: string; roof_color: string; hidden: boolean; cropped: boolean
  surfaces?: Record<string,SurfaceFinish>; replacement?: FeatureReplacement|null
}
export interface GeographicContext {
  version: 1; source: 'OpenStreetMap'; attribution: '© OpenStreetMap contributors · ODbL 1.0'
  source_date: string; lat: number; lon: number; width: number; depth: number
  features: MapFeature[]; hidden_layers: MapKind[]; detail: 'balanced'|'detailed'
  coverage_note?: string
}
export const mapLayers: Record<MapKind,string> = { building:'Buildings',road:'Roads & paths',rail:'Rail',paving:'Paving & parking',grass:'Landscape',water:'Water',tree:'Trees',wood:'Woodland' }
