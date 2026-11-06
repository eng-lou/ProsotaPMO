import type { Step } from './types'

export type SimSymbol = 'scope' | 'steps' | 'resources' | 'disruption' | 'results' | 'fixed' | 'rate' | 'cycle' | 'illustrative'
export function SimIcon({kind}:{kind:SimSymbol}) {
  const paths:Record<SimSymbol,string>= {
    scope:'M4 5h6v6H4z M14 5h6v6h-6z M4 15h6v6H4z M14 15h6v6h-6z',
    steps:'M3 6h5v5H3z M16 13h5v5h-5z M8 8h10v5 M6 16v4h10',
    resources:'M3 18V9h11v9 M14 12h4l3 4v2h-7 M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    disruption:'M12 3 2 21h20L12 3 M12 9v5 M12 17v1',
    results:'M3 4v17h19 M6 7h7v3H6z M10 13h10v3H10z',
    fixed:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2',
    rate:'M3 20h18 M5 17V12h3v5 M11 17V8h3v9 M17 17V4h3v13',
    cycle:'M4 10a8 8 0 0 1 14-4l2 2 M20 3v5h-5 M20 14a8 8 0 0 1-14 4l-2-2 M4 21v-5h5',
    illustrative:'M4 4h16v16H4z M10 8l6 4-6 4V8',
  }
  return <svg className="sim-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]}/></svg>
}
export const methods:{id:Step['basis'];title:string;description:string}[]=[
  {id:'fixed',title:'Set a duration',description:'Known working time'},
  {id:'rate',title:'Use a production rate',description:'Quantity ÷ output per hour'},
  {id:'cycle',title:'Repeat a work cycle',description:'Load → travel → tip → return'},
  {id:'illustrative',title:'Visual sequence',description:'Illustrative timing only'},
]
export function SimIntro({kind,title,children}:{kind:SimSymbol;title:string;children:React.ReactNode}){
  return <div className="sim-intro"><div className="sim-icon-box"><SimIcon kind={kind}/></div><div><h2>{title}</h2><p>{children}</p></div></div>
}
