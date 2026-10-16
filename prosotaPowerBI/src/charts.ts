export interface Amount { start: number; finish: number; value: number | null }
export interface Period { start: number; finish: number }
export function periods(start: number, finish: number, mode: 'weeks' | 'months'): Period[] {
    const result: Period[] = [];
    const date = new Date(start);
    date.setUTCHours(0,0,0,0);
    if (mode === 'months') date.setUTCDate(1);
    else date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    let cursor = date.getTime();
    // Coarsen extreme ranges without silently dropping the end of the schedule.
    const step=Math.max(1,Math.ceil((finish-start)/(mode==='months'?28:7)/86400000/500));
    while (cursor <= finish && result.length < 600) {
        const next = new Date(cursor);
        if (mode === 'months') next.setUTCMonth(next.getUTCMonth()+step);
        else next.setUTCDate(next.getUTCDate()+7*step);
        result.push({start:cursor, finish:next.getTime()}); cursor=next.getTime();
    }
    return result;
}
export function fraction(amount: Amount, date: number): number {
    return amount.finish <= amount.start ? (date >= amount.start ? 1 : 0) : Math.max(0,Math.min(1,(date-amount.start)/(amount.finish-amount.start)));
}
export function phase(amounts: Amount[], bins: Period[], cumulative = false): (number | null)[] {
    const known = amounts.filter(a=>a.value !== null);
    return bins.map(bin => !known.length ? null : known.reduce((sum,a)=>sum + a.value! * (cumulative ? fraction(a,bin.finish) : a.finish <= a.start ? Number(a.start>=bin.start && a.start<bin.finish) : fraction(a,bin.finish)-fraction(a,bin.start)),0));
}
const ns='http://www.w3.org/2000/svg';
function svgNode(tag: string, attrs: Record<string,string|number>, text?: string) { const n=document.createElementNS(ns,tag); for(const [k,v] of Object.entries(attrs)) n.setAttribute(k,String(v)); if(text!==undefined)n.textContent=text; return n; }
export function chart(bins: Period[], values: (number|null)[], line: boolean, format: (v:number)=>string, now: number, label: string): HTMLElement {
    const wrap=document.createElement('div');wrap.className='time-chart';
    if(!bins.length || values.every(v=>v===null)){wrap.textContent='No values available for this selection.';wrap.classList.add('empty-chart');return wrap;}
    const width=Math.max(560,bins.length* (line ? 14 : 28)), height=210, left=64, right=28, top=20, bottom=38;
    const w=width-left-right,h=height-top-bottom,max=Math.max(1,...values.map(v=>v??0))*1.08,min=Math.min(0,...values.map(v=>v??0))*1.08;
    const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':label});
    svg.setAttribute('style',`width:${width}px;min-width:100%;display:block`);
    svg.append(svgNode('title',{},label));
    for(let i=0;i<=4;i++){const y=top+h-h*i/4;svg.append(svgNode('line',{x1:left,x2:width-right,y1:y,y2:y,stroke:'#e6ecf4'}),svgNode('text',{x:left-9,y:y+4,'text-anchor':'end',fill:'#61738c','font-size':11},format(min+(max-min)*i/4)));}
    const start=bins[0].start,end=bins[bins.length-1].finish;
    const x=(date:number)=>left+(date-start)/(end-start)*w;
    const y=(value:number)=>top+h-(value-min)/(max-min)*h;
    const stride=Math.max(1,Math.ceil(bins.length/8));
    bins.forEach((bin,i)=>{if(i%stride===0){svg.append(svgNode('text',{x:x((bin.start+bin.finish)/2),y:height-15,'text-anchor':'middle',fill:'#61738c','font-size':11},new Date(bin.start).toLocaleDateString('en-GB',{day:bin.finish-bin.start<=7*86400000?'numeric':undefined,month:'short',year:bin.finish-bin.start>7*86400000?'2-digit':undefined,timeZone:'UTC'})));}});
    if(line){const points=[`${x(start)},${y(0)}`,...values.map((v,i)=>`${x(bins[i].finish)},${y(v??0)}`)].join(' ');svg.append(svgNode('polyline',{points,fill:'none',stroke:'#3984fc','stroke-width':2.5}));}
    values.forEach((v,i)=>{if(v===null)return;const bin=bins[i];const mark=line?svgNode('circle',{cx:x(bin.finish),cy:y(v),r:3,fill:'#3984fc'}):svgNode('rect',{x:x(bin.start)+3,y:Math.min(y(v),y(0)),width:Math.max(1,x(bin.finish)-x(bin.start)-6),height:Math.abs(y(v)-y(0)),fill:'#5289fb',rx:2});mark.append(svgNode('title',{},`${new Date(bin.start).toLocaleDateString('en-GB',{timeZone:'UTC'})}: ${format(v)}`));svg.append(mark);});
    const cursor=svgNode('line',{x1:x(now),x2:x(now),y1:top,y2:top+h,stroke:'#142745','stroke-dasharray':'4 3',class:'chart-playhead'});cursor.setAttribute('data-start',String(start));cursor.setAttribute('data-end',String(end));cursor.setAttribute('data-left',String(left));cursor.setAttribute('data-width',String(w));cursor.setAttribute('visibility',now<start||now>end?'hidden':'visible');svg.append(cursor);
    wrap.append(svg);return wrap;
}
