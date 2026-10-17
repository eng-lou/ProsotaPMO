export type MaritimeMode = 'operate' | 'train' | 'deliver'
export interface Scenario { cargo: number; rate: number; arrival: number; breakdown: boolean; outageStart: number; outageHours: number }
export const DEFAULT_SCENARIO: Scenario = { cargo: 1200, rate: 30, arrival: 2, breakdown: true, outageStart: 8, outageHours: 6 }
export interface PortAsset { id: string; name: string; type: string; description: string }
export const ASSETS: PortAsset[] = [
  { id: 'vessel-01', name: 'MV Horizon', type: 'Container vessel', description: 'Synthetic arrival with one container handling cycle per move. No live AIS connection.' },
  { id: 'berth-01', name: 'Berth 01', type: 'Infrastructure', description: 'Existing berth serving two ship-to-shore cranes.' },
  { id: 'crane-01', name: 'Quayside crane 01', type: 'Equipment', description: 'Independent handling crane. The disruption scenario applies to this asset.' },
  { id: 'crane-02', name: 'Quayside crane 02', type: 'Equipment', description: 'Independent handling crane. Remains available during crane 01 outage.' },
  { id: 'yard-01', name: 'Container yard', type: 'Storage', description: 'Illustrative cargo storage. Yard congestion is not modelled in this first scenario.' },
  { id: 'truck-01', name: 'Terminal tractor 01', type: 'Vehicle', description: 'Illustrative haul route. Travel animation is not a vehicle-capacity calculation.' },
  { id: 'expansion-01', name: 'Berth expansion', type: 'Delivery', description: 'Proposed berth and crane foundation. Shares this terminal scene with operations and training.' },
  { id: 'hazard-01', name: 'Restricted lifting zone', type: 'Safety zone', description: 'A worker enters the active lifting zone beneath crane 01 in the training exercise.' },
]
export function normaliseScenario(input: Partial<Scenario>): Scenario {
  const number=(v:unknown,fallback:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback
  return { cargo:Math.round(number(input.cargo,1200,1,100000)), rate:number(input.rate,30,1,120), arrival:number(input.arrival,2,0,48), breakdown:typeof input.breakdown==='boolean'?input.breakdown:true,outageStart:number(input.outageStart,8,0,120),outageHours:number(input.outageHours,6,0,48) }
}
export function capacity(s:Scenario,hour:number):number { return s.rate*(s.breakdown&&hour>=s.outageStart&&hour<s.outageStart+s.outageHours?1:2) }
export function handled(s:Scenario,hour:number):number {
  const elapsed=Math.max(0,hour-s.arrival)
  const lost=s.breakdown?Math.max(0,Math.min(hour,s.outageStart+s.outageHours)-Math.max(s.arrival,s.outageStart)):0
  return Math.min(s.cargo,Math.max(0,elapsed*s.rate*2-lost*s.rate))
}
export function completion(s:Scenario):number {
  const boundaries=[s.arrival,...(s.breakdown?[s.outageStart,s.outageStart+s.outageHours]:[])].filter(t=>t>=s.arrival).sort((a,b)=>a-b)
  let remaining=s.cargo,at=s.arrival
  for(const end of [...new Set(boundaries)]){if(end<=at)continue;const rate=capacity(s,at);const done=(end-at)*rate;if(done>=remaining)return at+remaining/rate;remaining-=done;at=end}
  return at+remaining/capacity(s,at)
}
export function comparison(s:Scenario) {const baseline=completion({...s,breakdown:false}),scenario=completion(s);return {baseline,scenario,delay:scenario-baseline,lostMoves:Math.max(0,s.cargo-handled(s,baseline))}}
export function safetyScore(hazardIdentified:boolean,response:string):number {return hazardIdentified&&response==='stop'?100:0}
export const DELIVERY_PHASES = [
  { id:'foundation',name:'Crane foundation',start:0,finish:12,assetId:'expansion-01' },
  { id:'deck',name:'Berth deck',start:12,finish:24,assetId:'expansion-01' },
  { id:'installation',name:'Crane installation',start:24,finish:32,assetId:'expansion-01' },
  { id:'commission',name:'Commissioning',start:32,finish:36,assetId:'expansion-01' },
]
