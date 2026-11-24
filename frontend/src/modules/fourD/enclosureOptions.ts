export const sitePosterTitles = ['PPE','Hearing protection','Site access','Fire exit','Site contacts'] as const
export type PosterTitle = typeof sitePosterTitles[number]
export interface SlabReference {
  ref:string
  name:string
  elevation:number
  rings:[number,number][][]
}
export interface ScaffoldRun {
  width:number
  lifts:number
  side:'left'|'right'
  netted:boolean
  stairs:number[]
  slabs?:SlabReference[]
  base_elevation?:number|null
  facade_gap?:number
  bay_edits?:Record<string,'gap'|'stairs'>
}
export const defaultScaffold:ScaffoldRun={width:1.2,lifts:3,side:'right',netted:false,stairs:[]}
