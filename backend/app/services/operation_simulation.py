"""Deterministic event simulation. No database access and no animation-frame clock."""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from math import ceil, prod
from app.schemas.simulation import SimulationConfig


def stamp(value):
    if isinstance(value,str):value=datetime.fromisoformat(value.replace('Z','+00:00'))
    if value.tzinfo is None:value=value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def iso(value):
    return datetime.fromtimestamp(value,timezone.utc).replace(tzinfo=None).isoformat(timespec='milliseconds')


def calculate(config:SimulationConfig, context:dict, *, estimate=False):
    cfg=config.model_dump(mode='json'); start=stamp(cfg['start']); end=start+cfg['horizon_days']*86400
    activities={a['id']:a for a in context['activities']}; resources={r['id']:r for r in cfg['resources']}
    steps={s['id']:s for s in cfg['steps']}; issues=[]; warnings=[]; tasks=[]; completed=defaultdict(list); begun={}; totals={}
    windows={k:[(max(start,stamp(a)),min(end,stamp(b))) for a,b in rows if stamp(b)>start and stamp(a)<end] for k,rows in context['windows'].items()}
    # Physical scene instances are exclusive even when no costing resource is assigned.
    for s in cfg['steps']:
        m=s.get('worker_method')
        if not m:continue
        for role in ('worker_id','tool_id'):
            key='@actor:'+m[role]
            resources[key]={'id':key,'name':('Worker' if role=='worker_id' else 'Tool')+' already in use','capacity':1}
            windows['resource:'+key]=[(start,end)]
    disruptions=[{**d,'a':stamp(d['start']),'b':stamp(d['end']) if d['end'] else end} for d in cfg['disruptions']]
    # Boundaries are explicit external commitments; treating them as available is an auditable assumption.
    boundaries=context.get('boundaries',[]) if cfg['boundary_policy']=='reserve' else []
    if cfg['boundary_policy']=='assume_available':warnings.append('Outside-scope resource commitments are assumed available.')
    if estimate:warnings.append('Capacity estimate: resource competition and queues are excluded. Use event simulation before accepting programme changes.')
    def work_windows(s):
        return windows.get('activity:'+s['activity_id'],[])
    def missing(s,why):issues.append({'step_id':s['id'],'activity_id':s['activity_id'],'reason':why})
    for s in cfg['steps']:
        if s['activity_id'] not in activities:missing(s,'Activity is missing from the source programme');continue
        total=s['quantity']; remaining=None if total is None else max(0,total-s['completed_quantity'])
        if s['is_complete'] or remaining==0:
            totals[s['id']]=1;completed[s['id']]=[start];begun[s['id']]=start;continue
        if any(c['status']=='pending' for c in s['conditions']):missing(s,'Pending: '+', '.join(c['name'] for c in s['conditions'] if c['status']=='pending'));continue
        for c in s['conditions']:
            if c['status']=='assumed':warnings.append(s['name']+': assumes '+c['name'])
        if s['access_required'] and not s['access_windows']:missing(s,'No access window supplied');continue
        if not work_windows(s):missing(s,'No working calendar time inside the simulation horizon');continue
        if s.get('worker_method'):
            m=s['worker_method'];route=m.get('route')
            if not route:missing(s,'Prepare the worker method route before running');continue
            count=1;fraction=m['work_position']/100;travel=route['length_m']/m['speed_mps']
            phases=[dict(id=stage,name=label,hours=seconds/3600,resources=[],state=state,object_states=[],route_id=None,speed_mps=None,
                         worker_action=dict(stage=stage,seconds=seconds,from_progress=a,to_progress=b))
                    for stage,label,seconds,state,a,b in [
                        ('approach','Walk in',travel*fraction,'travelling',0,fraction),
                        ('work','Use tool',m['work_seconds'],'working',fraction,fraction),
                        ('continue','Continue',travel*(1-fraction),'travelling',fraction,1)]]
        elif s['basis']=='cycle':
            if remaining is None or not s['cycle_quantity'] or not s['phases']:missing(s,'Cycle needs quantity, quantity per cycle and phases');continue
            count=ceil(remaining/s['cycle_quantity']); phases=s['phases']
        else:
            count=1;hours=s['hours']
            if s['basis']=='rate':
                if remaining is None or not s['rate_per_hour']:missing(s,'Production timing needs quantity and rate per hour');continue
                hours=remaining/s['rate_per_hour']
            phases=[dict(id='operation',name=s['name'],hours=hours,resources=[],state='working',object_states=s['object_states'],route_id=None,speed_mps=None)]
        if count>2000 or len(tasks)+count*len(phases)>10000:missing(s,'Too many cycles; use a coarser quantity per cycle (limit 10,000 operations)');continue
        for p in phases:
            if p.get('bucket_loading'):
                b=p['bucket_loading'];p['hours']=ceil(s['cycle_quantity']/(b['capacity_m3']*b['fill_factor']))*b['cycle_seconds']/3600
            if p['route_id']:
                length=context.get('routes',{}).get(p['route_id'])
                if length is None or not p['speed_mps']:missing(s,'Route length and travel speed are required');break
                p['hours']=length/p['speed_mps']/3600
            if p['hours'] is None:missing(s,'Enter duration for '+p['name']);break
        else:
            totals[s['id']]=count
            for n in range(count):
                owner=s['id']+':'+str(n);previous=None
                q=min(s['cycle_quantity'],remaining-n*s['cycle_quantity']) if s['basis']=='cycle' else remaining
                for i,p in enumerate(phases):
                    hours=p['hours']
                    if p.get('bucket_loading'):
                        b=p['bucket_loading'];hours=ceil(q/(b['capacity_m3']*b['fill_factor']))*b['cycle_seconds']/3600
                    req={r['resource_id']:r['units'] for r in s['resources']}
                    for r in p['resources']:req[r['resource_id']]=max(req.get(r['resource_id'],0),r['units'])
                    hold={r['resource_id']:r['units'] for r in s['hold_resources']}
                    if s.get('worker_method'):
                        for role in ('worker_id','tool_id'):hold['@actor:'+s['worker_method'][role]]=1
                    for r,u in hold.items():req[r]=max(req.get(r,0),u)
                    task=dict(order=len(tasks),id=owner+':'+p['id'],step=s['id'],owner=owner,phase=p,previous=previous,last=i==len(phases)-1,req=req,hold=hold,
                              remaining=hours*3600,total=hours*3600,quantity=q,status='waiting',segments=[],first=None,finish=None,wait_reason='Dependencies',allocated={})
                    tasks.append(task);previous=task
    # Never invent an operation for an unconfigured activity.
    for aid in cfg['activity_ids']:
        if not any(s['activity_id']==aid for s in cfg['steps']):issues.append({'activity_id':aid,'step_id':None,'reason':'No operational steps configured'})
    static_issues={x['step_id'] for x in issues}; slots={r:['']*d['capacity'] for r,d in resources.items()}; held={}; active_owners=defaultdict(set); segments=[]; waits=[]; points=[]; now=start
    boundaries=[{**b,'a':stamp(b['start']),'b':stamp(b['end'])} for b in boundaries]
    changes={start,end}
    for rows in windows.values():
        for a,b in rows:changes.update((a,b))
    for d in disruptions:changes.update((d['a'],d['b']))
    for b in boundaries:changes.update((b['a'],b['b']))
    for s in cfg['steps']:
        for w in s['access_windows']:changes.update((stamp(w['start']),stamp(w['end'])))
        if s['earliest_start']:changes.add(stamp(s['earliest_start']))
        for c in s['conditions']:
            if c['available_from']:changes.add(stamp(c['available_from']))
    changes=sorted(t for t in changes if start<=t<=end); ci=0
    def inside(rows,t):return any(a<=t<b for a,b in rows)
    def closed_until(rows,t):
        return next((b for a,b in rows if a<=t<b),t)
    def blocked_units(r,t):
        count=sum(d['unavailable_units'] for d in disruptions if d['target']=='resource' and d['target_id']==r and d['kind']=='outage' and d['a']<=t<d['b'])
        count+=sum(b['units'] for b in boundaries if b['resource_id']==r and b['a']<=t<b['b'])
        return min(resources[r]['capacity'],count)
    def lag_release(value,link,task):
        seconds=link['lag_hours']*3600
        if link.get('lag_basis')!='working':return value+seconds
        if seconds==0:return value
        for a,b in work_windows(steps[task['step']]):
            a=max(a,value)
            if b<=a:continue
            if b-a>=seconds:return a+seconds
            seconds-=b-a
        return end+1
    def ready(task,t):
        s=steps[task['step']]
        if task['previous'] and task['previous']['status']!='done':return False,'Previous phase'
        if not task['previous'] and s['basis']=='cycle' and not s['hold_resources']:
            active=active_owners[s['id']]
            if active and task['owner'] not in active:return False,'Previous cycle (reserve fleet units to overlap cycles)'
        limits=[stamp(s['earliest_start'])] if s['earliest_start'] else []
        limits += [stamp(c['available_from']) for c in s['conditions'] if c['available_from']]
        groups=defaultdict(list)
        for i,d in enumerate(s['dependencies']):groups[d.get('any_group') or str(i)].append(d)
        for links in groups.values():
            releases=[]
            for d in links:
                other=d['step_id']
                if other in static_issues:continue
                if d['relation']=='start':value=begun.get(other)
                else:
                    needed=ceil(totals.get(other,1)*d['release_fraction']);done=completed[other]
                    value=done[needed-1] if len(done)>=needed else None
                if value is not None:releases.append(lag_release(value,d,task))
            if not releases:return False,'Waiting for '+', '.join(steps[d['step_id']]['name'] for d in links)
            limits.append(min(releases))
        if limits and max(limits)>t+1e-6:return False,'Release date'
        return True,''
    def available(task,t):
        s=steps[task['step']]; ws=work_windows(s)
        if not inside(ws,t):return False,'Activity calendar',t
        until=closed_until(ws,t)
        if s['access_required'] or s['access_windows']:
            access=[(stamp(w['start']),stamp(w['end'])) for w in s['access_windows']]
            if not inside(access,t):return False,'Access window',t
            until=min(until,closed_until(access,t))
        for d in disruptions:
            if d['kind']=='outage' and d['target']=='step' and d['target_id']==s['id'] and d['a']<=t<d['b']:return False,d['name'],t
            if d['kind']=='outage' and d['target']=='step' and d['target_id']==s['id'] and d['a']>t:until=min(until,d['a'])
        for r in task['req']:
            for b in boundaries:
                if b['resource_id']==r and b['a']>t:until=min(until,b['a'])
            rw=windows.get('resource:'+r,[])
            if not inside(rw,t):return False,resources[r]['name']+' calendar',t
            until=min(until,closed_until(rw,t))
            for d in disruptions:
                if d['kind']=='outage' and d['target']=='resource' and d['target_id']==r and d['a']>t:until=min(until,d['a'])
        for d in disruptions:
            if d['kind']=='productivity' and ((d['target']=='step' and d['target_id']==s['id']) or (d['target']=='resource' and d['target_id'] in task['req'])):
                if d['a']>t:until=min(until,d['a'])
                elif d['a']<=t<d['b']:until=min(until,d['b'])
        return True,'',until
    def rate(task,t):
        return prod([d['factor'] for d in disruptions if d['kind']=='productivity' and d['a']<=t<d['b'] and ((d['target']=='step' and d['target_id']==task['step']) or(d['target']=='resource' and d['target_id'] in task['req']))])
    def release(task,final=False):
        if estimate:return
        for r,indices in task['allocated'].items():
            for i in indices:
                if r not in task['hold'] or final:
                    if slots[r][i] in (task['id'],task['owner']):slots[r][i]=''
        task['allocated']={}
        if final:
            for r,indices in held.pop(task['owner'],{}).items():
                for i in indices:
                    if slots[r][i]==task['owner']:slots[r][i]=''
    def allocate(task,t):
        if estimate:return True,''
        picked={}
        for r,u in task['req'].items():
            unavailable=blocked_units(r,t)
            owned=held.get(task['owner'],{}).get(r,[])
            if any(i<unavailable for i in owned):return False,resources[r]['name']+' unavailable'
            free=owned+[i for i in range(unavailable,len(slots[r])) if not slots[r][i] and i not in owned]
            if len(free)<u:
                task['wait_resource_id']=r
                return False,'Waiting for '+resources[r]['name']
            picked[r]=free[:u]
        for r,indices in picked.items():
            for i in indices:slots[r][i]=task['owner'] if r in task['hold'] else task['id']
            if r in task['hold']:held.setdefault(task['owner'],{})[r]=indices
        task['allocated']=picked;return True,''
    event_budget=0
    for iteration in range(20000):
        if now>=end-1e-6:break
        for task in tasks:
            if task['status']=='running':
                ok,reason,_=available(task,now)
                if ok and not estimate:
                    ok=all(all(i>=blocked_units(r,now) for i in indices) for r,indices in task['allocated'].items())
                    if not ok:reason='Resource interruption'
                if not ok:release(task);task['status']='waiting';task['wait_reason']=reason
        # Repeated passes allow zero-length handovers to release a successor at the same instant.
        for _ in range(len(tasks)+1):
            zero=False
            for task in sorted(tasks,key=lambda x:(-steps[x['step']]['priority'], x['first'] if x['first'] is not None else start, x['order'])):
                if task['status']!='waiting':continue
                task['wait_resource_id']=None
                ok,reason=ready(task,now)
                if ok:
                    ok,reason,until=available(task,now)
                    if ok and not steps[task['step']]['resumable'] and until-now+1e-6<task['remaining']/rate(task,now):ok=False;reason='Operation must fit inside one access/working window'
                if ok:ok,reason=allocate(task,now)
                if not ok:task['wait_reason']=reason;continue
                active_owners[task['step']].add(task['owner']);task['status']='running';task['first']=now if task['first'] is None else task['first'];begun.setdefault(task['step'],now)
                if task['remaining']<=1e-6:
                    segments.append(dict(task_id=task['id'],step_id=task['step'],activity_id=steps[task['step']]['activity_id'],phase=task['phase']['name'],state=task['phase']['state'],start=iso(now),end=iso(now),progress_from=1,progress_to=1,resources=task['req'],object_states=task['phase']['object_states'],worker_action=task['phase'].get('worker_action')))
                    task['status']='done';task['finish']=now;release(task,task['last']);zero=True
                    if task['last']:active_owners[task['step']].discard(task['owner']);completed[task['step']].append(now);points.append(dict(step_id=task['step'],time=iso(now),quantity=task['quantity']))
            if not zero:break
        if all(t['status']=='done' for t in tasks):break
        while ci<len(changes) and changes[ci]<=now+1e-6:ci+=1
        candidates=[changes[ci]] if ci<len(changes) else [end]
        candidates += [now+t['remaining']/rate(t,now) for t in tasks if t['status']=='running']
        # Positive lags become new release events after a predecessor completes.
        for task in tasks:
            if task['status']=='waiting':
                for d in steps[task['step']]['dependencies']:
                    times=([begun[d['step_id']]] if d['relation']=='start' and d['step_id'] in begun else completed[d['step_id']])
                    candidates += [lag_release(v,d,task) for v in times if lag_release(v,d,task)>now+1e-6]
        nxt=min(end,*candidates)
        if nxt<=now+1e-6:nxt=now+1e-6
        for task in tasks:
            if task['status']=='waiting' and len(waits)<50000:
                waits.append(dict(step_id=task['step'],task_id=task['id'],start=iso(now),end=iso(nxt),reason=task['wait_reason'],resource_id=task.get('wait_resource_id')))
            if task['status']!='running':continue
            amount=min(task['remaining'],(nxt-now)*rate(task,now));p0=1-task['remaining']/max(task['total'],1e-9);task['remaining']-=amount
            event=dict(task_id=task['id'],step_id=task['step'],activity_id=steps[task['step']]['activity_id'],phase=task['phase']['name'],state=task['phase']['state'],start=iso(now),end=iso(nxt),progress_from=p0,progress_to=1-task['remaining']/max(task['total'],1e-9),resources=task['req'],object_states=task['phase']['object_states'])
            event['worker_action']=task['phase'].get('worker_action')
            segments.append(event);task['segments'].append(event)
            if task['remaining']<=1e-6:
                task['status']='done';task['finish']=nxt;release(task,task['last'])
                if task['last']:active_owners[task['step']].discard(task['owner']);completed[task['step']].append(nxt);points.append(dict(step_id=task['step'],time=iso(nxt),quantity=task['quantity']))
        now=nxt
        event_budget+=len(tasks)
        if len(segments)>50000 or event_budget>3000000:
            issues.append(dict(step_id=None,activity_id=None,reason='Detailed simulation limit reached. Reduce the scope or combine smaller cycles.'));break
    else:issues.append(dict(step_id=None,activity_id=None,reason='Event limit reached; reduce the scope or cycle count'))
    step_results=[]
    for s in cfg['steps']:
        own=[t for t in tasks if t['step']==s['id']]; done=len(completed[s['id']]); expected=totals.get(s['id'],0)
        ok=expected>0 and done==expected; first=begun.get(s['id']); finish=max(completed[s['id']]) if ok else None
        if not ok and own:missing(s,next((t['wait_reason'] for t in own if t['status']!='done'),'Unfinished work'))
        productive=sum(sum(stamp(e['end'])-stamp(e['start']) for e in t['segments']) for t in own)/3600
        elapsed=(finish-first)/3600 if finish is not None and first is not None else None
        step_results.append(dict(id=s['id'],activity_id=s['activity_id'],name=s['name'],start=iso(first) if first is not None else None,finish=iso(finish) if finish is not None else None,status='complete' if ok else 'unresolved',cycles=done,required_cycles=expected,productive_hours=productive,elapsed_hours=elapsed,quantity=s['completed_quantity']+sum((p['quantity'] or 0) for p in points if p['step_id']==s['id']),unit=s['unit'],illustrative=s['basis']=='illustrative'))
    # Two operations cannot carry the same physical element at the same time.
    uses=defaultdict(list)
    for e in segments:
        for h in e['object_states']:uses[(h['model_ref'],h.get('element_id'))].append(e)
    for key,events in uses.items():
        events.sort(key=lambda e:e['start']);latest=None
        for e in events:
            if latest and e['start']<latest['end'] and e['task_id']!=latest['task_id']:
                issues.append(dict(step_id=e['step_id'],activity_id=e['activity_id'],reason='Overlapping handling of '+key[0]+'. Add a handover dependency or use different instances.'));break
            if not latest or e['end']>latest['end']:latest=e
    if len(waits)>=50000:warnings.append('Waiting report capped at 50,000 intervals; execution timing is still calculated.')
    metrics=[]
    for r in cfg['resources']:
        queue=[w for w in waits if w.get('resource_id')==r['id']]
        waiting_hours=sum(stamp(w['end'])-stamp(w['start']) for w in queue)/3600
        queue_changes=[]
        for w in queue:queue_changes.extend([(stamp(w['start']),1),(stamp(w['end']),-1)])
        count=0;peak_queue=0
        for _,delta in sorted(queue_changes):count+=delta;peak_queue=max(peak_queue,count)
        working=sum((stamp(e['end'])-stamp(e['start']))/3600*e['resources'].get(r['id'],0) for e in segments)
        span_end=max([stamp(e['end']) for e in segments]+[start]);available_hours=0
        cuts=sorted(set(changes+[span_end]))
        for a,b in zip(cuts,cuts[1:]):
            if a>=span_end:break
            if inside(windows.get('resource:'+r['id'],[]),a):available_hours+=(min(b,span_end)-a)/3600*(r['capacity']-blocked_units(r['id'],a))
        metrics.append(dict(id=r['id'],name=r['name'],working_hours=working,available_hours=available_hours,utilisation=working/available_hours*100 if available_hours else 0,cost=working*r['hourly_cost'] if r['hourly_cost'] is not None else None,waiting_hours=waiting_hours,peak_queue=peak_queue))
    return dict(status='incomplete' if issues else 'current',basis='capacity_estimate' if estimate else 'event_simulation',steps=step_results,events=segments,waiting=waits,production=points,resources=metrics,issues=issues,warnings=list(dict.fromkeys(warnings)),start=iso(start),finish=iso(max([stamp(s['finish']) for s in step_results if s['finish']]+[start])))
