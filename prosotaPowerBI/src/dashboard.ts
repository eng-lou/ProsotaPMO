import { pickActiveLink } from './generated/animation';
import { Viewer } from './viewer';
import { loadIfc } from './ifc';
import { Snapshot, Task, total } from './types';
import { chart, periods, phase } from './charts';
const dateLabel = (v: number) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; }
export class Dashboard {
    readonly current: Viewer;
    readonly baseline: Viewer;
    private root: HTMLElement;
    private note: HTMLElement;
    private range: HTMLInputElement;
    private date: HTMLElement;
    private dateInput: HTMLInputElement;
    private speed = 1;
    private kpis: HTMLElement;
    private schedule: HTMLElement;
    private details: HTMLElement;
    private resources: HTMLElement;
    private costs: HTMLElement;
    private title: HTMLElement;
    private baselinePane: HTMLElement;
    private level: HTMLSelectElement;
    private discipline: HTMLSelectElement;
    private search = '';
    private scheduleZoom = 'fit';
    private chartPeriod: 'weeks' | 'months' = 'months';
    private resourceMetric = 'cost';
    private selected: string | null = null;
    private now = Date.now();
    private min = this.now;
    private max = this.now + 86400000;
    private useProfiles = true;
    private compare = false;
    private linked = true;
    private isolate = false;
    private timer?: ReturnType<typeof setInterval>;
    private loadVersion = { current: 0, baseline: 0 };
    private destroyed = false;
    private imported?: Snapshot;
    private bound?: Snapshot;
    private get snapshot() { return this.bound ?? this.imported; }
    onClear?: () => void;
    onSelect?: (task: Task) => void;
    onLoaded?: () => void;
    constructor(host: HTMLElement) {
        this.root = node('div', '', 'prosota-bi');
        host.append(this.root);
        const header = node('header');
        header.append(node('strong', 'PROSOTA'), node('span', 'Project controls'));
        this.root.append(header);
        const top = node('section', '', 'report-top');
        this.title = node('h2', 'Open an integrated IFC');
        top.append(this.title);
        this.level = node('select');
        this.discipline = node('select');
        this.level.setAttribute('aria-label', 'Level');
        this.discipline.setAttribute('aria-label', 'Discipline');
        top.append(this.level, this.discipline);
        this.kpis = node('div', '', 'kpis');
        top.append(this.kpis);
        this.root.append(top);
        this.level.onchange = this.discipline.onchange = () => { this.renderData(); this.apply(); };
        const main = node('div', '', 'main-grid'), model = node('section', '', 'panel model'), bar = node('div', '', 'toolbar');
        bar.append(node('strong', 'BIM & 4D sequence'));
        this.fileButton(bar, 'Open IFC', 'current');
        this.button(bar, 'Frame', () => { this.current.frame(); if (this.compare)
            this.baseline.frame(); });
        const isolate = this.button(bar, 'Isolate', () => { this.isolate = !this.isolate; isolate.setAttribute('aria-pressed', String(this.isolate)); this.apply(); });
        this.button(bar, 'Clear selection', () => { this.selected = null; this.onClear?.(); this.renderData(); this.apply(); });
        this.toggle(bar, 'Compare baseline', false, v => { this.compare = v; this.baselinePane.hidden = !v; this.current.resize(); this.baseline.resize(); this.renderData(); });
        const panes = node('div', '', 'model-panes'), currentPane = node('div', '', 'model-pane');
        currentPane.append(node('div', 'Current', 'pane-label'));
        const currentCanvas = node('div', '', 'canvas');
        currentPane.append(currentCanvas);
        this.baselinePane = node('div', '', 'model-pane');
        this.baselinePane.hidden = true;
        const baselineHead = node('div', '', 'toolbar');
        baselineHead.append(node('span', 'Baseline'));
        this.fileButton(baselineHead, 'Open baseline IFC', 'baseline');
        this.toggle(baselineHead, 'Link cameras', true, v => { this.linked = v; if (v)
            this.baseline.copyCamera(this.current); });
        const baselineCanvas = node('div', '', 'canvas');
        this.baselinePane.append(baselineHead, baselineCanvas);
        panes.append(currentPane, this.baselinePane);
        model.append(bar, panes);
        this.current = new Viewer(currentCanvas);
        this.baseline = new Viewer(baselineCanvas);
        this.current.onCamera = () => { if (this.linked && this.compare)
            this.baseline.copyCamera(this.current); };
        this.baseline.onCamera = () => { if (this.linked && this.compare)
            this.current.copyCamera(this.baseline); };
        for (const viewer of [this.current, this.baseline])
            viewer.onSelect = guid => { const l = pickActiveLink(viewer.loaded?.snapshot.links.filter(l => l.element === guid) ?? [], new Date(this.now)); if (l) {
                const source = viewer.loaded?.snapshot.tasks.find(t => t.id === l.taskId);
                const task = this.snapshot?.tasks.find(t => t.id === source?.id || t.code === source?.code);
                if (task)
                    this.select(task.id);
            } };
        const playback = node('div', '', 'toolbar');
        this.button(playback, 'Start', () => { this.now = this.min; this.syncDate(); });
        this.button(playback, 'End', () => { this.now = this.max; this.syncDate(); });
        const play = this.button(playback, 'Play', () => { if (this.timer) {
            this.stop(play);
            return;
        } if (this.now >= this.max)
            this.now = this.min; play.textContent = 'Pause'; this.timer = setInterval(() => { this.now = Math.min(this.max, this.now + (this.max - this.min) / 240 * this.speed); this.syncDate(); if (this.now >= this.max)
            this.stop(play); }, 100); });
        this.range = node('input');
        this.range.type = 'range';
        this.range.min = '0';
        this.range.max = '1000';
        this.range.setAttribute('aria-label', 'Sequence date');
        this.range.oninput = () => { this.now = this.min + (this.max - this.min) * Number(this.range.value) / 1000; this.syncDate(); };
        this.date = node('span');
        this.dateInput=node('input');this.dateInput.type='date';this.dateInput.setAttribute('aria-label','Playback date');this.dateInput.onchange=()=>{const value=Date.parse(this.dateInput.value+'T12:00:00');if(Number.isFinite(value)){this.now=Math.max(this.min,Math.min(this.max,value));this.syncDate();}};
        const speed=node('select');speed.setAttribute('aria-label','Playback speed');for(const value of [.5,1,2,4])speed.add(new Option(`${value}x`,String(value)));speed.value='1';speed.onchange=()=>{this.speed=Number(speed.value);};
        playback.append(this.range, this.dateInput,speed);
        this.toggle(playback, 'Respect Prosota profiles', true, v => { this.useProfiles = v; this.apply(); });
        model.append(playback);
        const side = node('div', '', 'side');
        this.schedule = this.panel(side, 'Schedule');
        const schedulePanel = this.schedule.parentElement!;
        schedulePanel.classList.add('schedule-panel');
        const scheduleControls=node('div','','schedule-controls');
        const search=node('input');search.type='search';search.placeholder='Search activities';search.setAttribute('aria-label','Search activities');search.oninput=()=>{this.search=search.value;this.renderData();};
        const zoom=node('select');zoom.setAttribute('aria-label','Schedule zoom');for(const [value,label] of [['fit','Fit timeline'],['months','Months'],['weeks','Weeks']])zoom.add(new Option(label,value));zoom.onchange=()=>{this.scheduleZoom=zoom.value;this.renderData();};
        scheduleControls.append(search,zoom);
        const expand=this.button(scheduleControls,'Expand',()=>{const expanded=schedulePanel.classList.toggle('expanded-schedule');expand.textContent=expanded?'Close expanded schedule':'Expand';expand.setAttribute('aria-pressed',String(expanded));if(expanded){this.root.scrollTop=0;schedulePanel.style.height=`${this.root.clientHeight-24}px`;}else schedulePanel.style.height='';});
        schedulePanel.insertBefore(scheduleControls,this.schedule);
        this.schedule.classList.add('schedule-scroll');
        this.details = this.panel(side, 'Selected activity');
        main.append(model, side);
        this.root.append(main);
        const lower = node('div', '', 'lower-grid');
        this.resources = this.panel(lower, 'Resource plan');
        this.costs = this.panel(lower, 'Cost performance');
        this.root.append(lower);
        const chartControls=node('div','','chart-controls');
        const period=node('select');period.setAttribute('aria-label','Chart periods');period.add(new Option('Monthly','months'));period.add(new Option('Weekly','weeks'));period.onchange=()=>{this.chartPeriod=period.value as 'weeks'|'months';this.renderData();};
        const metric=node('select');metric.setAttribute('aria-label','Resource measure');metric.add(new Option('Budget cost','cost'));metric.add(new Option('Budget hours','hours'));metric.onchange=()=>{this.resourceMetric=metric.value;this.renderData();};
        chartControls.append(node('span','Time-based plan'),period,metric);this.root.insertBefore(chartControls,lower);
        const footer = node('footer');
        footer.append(node('span', 'Overview'), node('span', 'Risk · Planned'), node('span', 'ICD · Planned'));
        this.note = node('div', '', 'notice');
        this.note.setAttribute('role', 'status');
        this.root.append(footer, this.note);
        this.filters();
        this.renderData();
    }
    private button(parent: HTMLElement, label: string, click: () => void) { const b = node('button', label); b.type = 'button'; b.onclick = click; parent.append(b); return b; }
    private toggle(parent: HTMLElement, label: string, checked: boolean, change: (v: boolean) => void) { const wrap = node('label'), input = node('input'); input.type = 'checkbox'; input.checked = checked; input.onchange = () => change(input.checked); wrap.append(input, document.createTextNode(label)); parent.append(wrap); }
    private fileButton(parent: HTMLElement, label: string, kind: 'current' | 'baseline') { const input = node('input'); input.type = 'file'; input.accept = '.ifc'; input.hidden = true; input.onchange = () => { const f = input.files?.[0]; if (f)
        void this.open(f, kind); input.value = ''; }; this.button(parent, label, () => input.click()); parent.append(input); }
    private panel(parent: HTMLElement, label: string) { const section = node('section', '', 'panel'); section.append(node('h3', label)); const content = node('div'); section.append(content); parent.append(section); return content; }
    async open(file: File, kind: 'current' | 'baseline', showFinish = false) {
        if (kind === 'baseline' && !this.current.loaded) {
            this.note.textContent = 'Open the current IFC before adding a baseline.';
            return;
        }
        const version = ++this.loadVersion[kind];
        this.note.textContent = `Opening ${file.name}…`;
        try {
            const loaded = await loadIfc(new Uint8Array(await file.arrayBuffer()), file.name, s => { if (!this.destroyed)
                this.note.textContent = s; });
            if (this.destroyed || version !== this.loadVersion[kind]) {
                loaded.dispose();
                return;
            }
            this[kind].setModel(loaded, kind === 'baseline' ? this.current.origin : undefined);
            this.note.textContent = loaded.snapshot.warnings.join(' ');
            if (kind === 'current') {
                this.imported = { ...loaded.snapshot, tasks: [...loaded.snapshot.tasks], links: [...loaded.snapshot.links] };
                this.bound = undefined;
                this.baseline.rebase(this.current.origin);
                this.title.textContent = file.name.replace(/\.ifc$/i, '');
                this.selected = null;
                this.filters();
            }
            if (kind === 'current')
                this.onLoaded?.();
            this.bounds();
            if (showFinish) {
                this.now = this.max;
                this.syncDate();
            }
            this.renderData();
            this.apply();
            if (this.linked)
                this.baseline.copyCamera(this.current);
        }
        catch (e) {
            if (!this.destroyed)
                this.note.textContent = e instanceof Error ? e.message : String(e);
        }
    }
    private filters() { for (const [select, key, label] of [[this.level, 'level', 'All levels'], [this.discipline, 'discipline', 'All disciplines']] as const) {
        const selected = select.value;
        select.replaceChildren(new Option(label, ''));
        const values = new Set(this.snapshot?.tasks.map(t => t[key]).filter(Boolean));
        for (const v of values)
            select.add(new Option(v, v));
        select.disabled = !values.size;
        if (values.has(selected))
            select.value = selected;
    } }
    private tasks() { return (this.snapshot?.tasks ?? []).filter(t => (!this.level.value || t.level === this.level.value) && (!this.discipline.value || t.discipline === this.discipline.value)); }
    private bounds() { const tasks = [...(this.snapshot?.tasks ?? []), ...(this.baseline.loaded?.snapshot.tasks ?? [])]; if (tasks.length) {
        this.min = Math.min(...tasks.map(t => t.start));
        this.max = Math.max(this.min + 86400000, ...tasks.map(t => t.finish));
        this.now = Math.max(this.min, Math.min(this.now, this.max));
    } this.syncDate(); }
    private syncDate() { this.range.value = String((this.now - this.min) / (this.max - this.min) * 1000); this.date.textContent = dateLabel(this.now);const localDate=new Date(this.now);this.dateInput.value=`${localDate.getFullYear()}-${String(localDate.getMonth()+1).padStart(2,'0')}-${String(localDate.getDate()).padStart(2,'0')}`; for (const line of this.schedule?.querySelectorAll<HTMLElement>('.date-line') ?? [])
        line.style.left = `${(this.now - this.min) / (this.max - this.min) * 100}%`;
        for(const line of this.root.querySelectorAll<SVGElement>('.chart-playhead')){const start=Number(line.dataset.start),end=Number(line.dataset.end),x=Number(line.dataset.left)+(this.now-start)/(end-start)*Number(line.dataset.width);line.setAttribute('x1',String(x));line.setAttribute('x2',String(x));line.setAttribute('visibility',this.now<start||this.now>end?'hidden':'visible');} this.apply(); }
    private stop(button: HTMLButtonElement) { clearInterval(this.timer); this.timer = undefined; button.textContent = 'Play'; }
    private select(id: string) { this.selected = id; const task = this.snapshot?.tasks.find(t => t.id === id); if (task)
        this.onSelect?.(task); this.renderData(); this.apply(); }
    private apply() { const scope = new Set(this.tasks().map(t => t.id)); this.current.apply(this.now, this.useProfiles, this.selected, this.isolate, scope); const current = this.snapshot?.tasks.find(t => t.id === this.selected); const baseTasks = this.baseline.loaded?.snapshot.tasks ?? []; const selected = baseTasks.find(t => t.id === current?.id || t.code === current?.code); const codes = new Set(this.tasks().map(t => t.code)); const baseScope = new Set(baseTasks.filter(t => scope.has(t.id) || codes.has(t.code)).map(t => t.id)); this.baseline.apply(this.now, this.useProfiles, selected?.id ?? null, this.isolate, baseScope); }
    private money(value: number | null) { if (value === null)
        return '—'; try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: this.snapshot?.currency ?? 'GBP', maximumFractionDigits: 0 }).format(value);
    }
    catch {
        return value.toLocaleString();
    } }
    private renderData() {
        const tasks = this.tasks(), snapshot = this.snapshot;
        this.kpis.replaceChildren();
        for (const [label, key] of [['Budget', 'budget'], ['Actual', 'actual'], ['Earned value', 'earned']] as const) {
            const card = node('div', '', 'kpi');
            card.append(node('span', tasks.some(t => t[key] === null) ? `${label} (known)` : label), node('strong', this.money(total(tasks.filter(t => t[key] !== null), key))));
            this.kpis.append(card);
        }
        const pv = total(tasks, 'planned'), ev = total(tasks, 'earned');
        const spi = node('div', '', 'kpi');
        spi.append(node('span', 'Schedule SPI'), node('strong', pv !== null && pv > 0 && ev !== null ? (ev / pv).toFixed(2) : '—'));
        this.kpis.append(spi);
        const scrollTop=this.schedule.scrollTop,scrollLeft=this.schedule.scrollLeft;
        this.schedule.replaceChildren();
        if (!tasks.length)
            this.schedule.append(node('p', 'Open a Prosota integrated IFC or bind schedule fields.', 'muted'));
        const tick = node('div', `${dateLabel(this.min)} — ${dateLabel(this.max)}`, 'muted');
        const grid=node('div','','schedule-grid');
        const durationDays=(this.max-this.min)/86400000;
        if(this.scheduleZoom!=='fit')grid.style.minWidth=`${300+Math.min(18000,durationDays*(this.scheduleZoom==='weeks'?6:1.5))}px`;
        this.schedule.append(tick,grid);
        const axis=node('div','','gantt-row gantt-axis');axis.append(node('strong','Activity'));const axisLane=node('div','','lane');
        const tickCount=this.scheduleZoom==='fit'?2:4;for(let i=0;i<=tickCount;i++){const label=node('span',new Date(this.min+(this.max-this.min)*i/tickCount).toLocaleDateString('en-GB',{day:durationDays<90?'numeric':undefined,month:'short',year:durationDays>=90?'2-digit':undefined}),'axis-label');label.style.left=`${i/tickCount*100}%`;axisLane.append(label);}axis.append(axisLane);grid.append(axis);
        const visibleTasks=tasks.filter(t=>`${t.code} ${t.name}`.toLowerCase().includes(this.search.toLowerCase()));
        if(tasks.length&&!visibleTasks.length)grid.append(node('p','No matching activities.','muted'));
        for (const task of visibleTasks) {
            const row = node('div', '', 'gantt-row');
            const b = this.button(row, task.name, () => this.select(task.id));
            b.title = `${task.code} · ${task.name}\n${dateLabel(task.start)} — ${dateLabel(task.finish)}`;
            b.setAttribute('aria-pressed',String(task.id===this.selected));
            row.classList.toggle('selected',task.id===this.selected);
            const lane = node('div', '', 'lane');
            const mark = node('span', '', 'current-bar');
            mark.style.left = `${(task.start - this.min) / (this.max - this.min) * 100}%`;
            mark.style.width = `${Math.max(.5, (task.finish - task.start) / (this.max - this.min) * 100)}%`;
            mark.title=`${dateLabel(task.start)} — ${dateLabel(task.finish)}`;
            if(task.start===task.finish)mark.classList.add('milestone');
            lane.append(mark);
            const baseline = this.baseline.loaded?.snapshot.tasks.find(t => t.id === task.id || t.code === task.code);
            if (this.compare && baseline) {
                const old = node('span', '', 'baseline-bar');
                old.style.left = `${(baseline.start - this.min) / (this.max - this.min) * 100}%`;
                old.style.width = `${Math.max(.5, (baseline.finish - baseline.start) / (this.max - this.min) * 100)}%`;
                lane.append(old);
            }
            row.append(lane);
            const line = node('i', '', 'date-line');
            line.style.left = `${(this.now - this.min) / (this.max - this.min) * 100}%`;
            lane.append(line);
            grid.append(row);
        }
        this.schedule.scrollTop=scrollTop;this.schedule.scrollLeft=scrollLeft;
        this.details.replaceChildren();
        const task = tasks.find(t => t.id === this.selected);
        if (task) {
            this.details.append(node('strong', `${task.code} · ${task.name}`), node('p', `${dateLabel(task.start)} — ${dateLabel(task.finish)}`), node('p', `Budget ${this.money(task.budget)} · Actual ${this.money(task.actual)} · Progress ${task.progress === null ? '—' : task.progress + '%'}`));
            const links = snapshot!.links.filter(l => l.taskId === task.id);
            this.details.append(node('p', `${links.length} linked elements · ${links[0]?.profile.transform_kind === 'none' ? 'Colour / opacity' : links[0]?.profile.transform_kind ?? 'Default'} profile`));
        }
        else
            this.details.append(node('p', 'Select a model element or activity.', 'muted'));
        const scope = new Set(task ? [task.id] : tasks.map(t => t.id));
        this.resources.replaceChildren();
        const rows = (snapshot?.resources ?? []).filter(r => scope.has(r.taskId));
        const byResource = new Map<string, number | null>();
        for (const r of rows) {
            const old = byResource.get(r.name), value=this.resourceMetric==='hours'?r.hours:r.cost;
            byResource.set(r.name, value === null || old === null ? null : (old ?? 0) + value);
        }
        const costTasks = tasks.filter(t => scope.has(t.id));
        const bins=periods(this.min,this.max,this.chartPeriod);
        const formatResource=(v:number)=>this.resourceMetric==='hours'?`${Math.round(v).toLocaleString()} h`:this.money(v);
        const resourceAmounts=rows.flatMap(r=>{const task=tasks.find(t=>t.id===r.taskId);return task?[{start:task.start,finish:task.finish,value:this.resourceMetric==='hours'?r.hours:r.cost}]:[];});
        this.resources.append(node('p',`${task ? task.code : 'Filtered schedule'} · Budgeted ${this.resourceMetric==='hours'?'hours':'cost'}`,'chart-caption'));
        this.resources.append(chart(bins,phase(resourceAmounts,bins),false,formatResource,this.now,'Resource budget by period'));
        this.resources.append(node('p','Estimated evenly across activity dates. Actual use and capacity are not supplied.','muted chart-note'));
        if(resourceAmounts.some(a=>a.value===null))this.resources.append(node('p','Some assignments have no value for this measure; only known amounts are plotted.','muted'));
        const resourceDetails=node('details');resourceDetails.append(node('summary',`Assignments (${rows.length})`));
        this.table(resourceDetails, ['Resource',this.resourceMetric==='hours'?'Budget hours':'Budget'], [...byResource].map(([name,value]) => [name,value===null?'—':formatResource(value)]));this.resources.append(resourceDetails);
        this.costs.replaceChildren();
        this.costs.append(node('p',`${task ? task.code : 'Filtered schedule'} · Cumulative planned budget`,'chart-caption'));
        this.costs.append(chart(bins,phase(costTasks.map(t=>({start:t.start,finish:t.finish,value:t.budget})),bins,true),true,v=>this.money(v),this.now,'Cumulative planned budget, estimated'));
        const metrics=node('div','','snapshot-metrics');
        for(const [label,key] of [['PV','planned'],['EV','earned'],['AC','actual']] as const){const card=node('div');card.append(node('span',`${label} snapshot${costTasks.some(t=>t[key]===null)?' (known)':''}`),node('strong',this.money(total(costTasks.filter(t=>t[key]!==null),key))));metrics.append(card);}this.costs.append(metrics);
        if(costTasks.some(t=>t.budget===null))this.costs.append(node('p','Incomplete budget: curve includes known activity budgets only.','muted'));
        this.costs.append(node('p','Budget curve uses elapsed-time estimates, not calendar-based PV. EV/AC are snapshot totals; history is not supplied. Dashed line: playback date.','muted chart-note'));
        const costDetails=node('details');costDetails.append(node('summary',`Activity costs (${costTasks.length})`));
        this.table(costDetails, ['Activity', 'Budget', 'Earned', 'Actual'], costTasks.map(t => [t.name, this.money(t.budget), this.money(t.earned), this.money(t.actual)]));this.costs.append(costDetails);
    }
    private table(parent: HTMLElement, headers: string[], rows: string[][]) { const table = node('table'), head = node('thead'), tr = node('tr'); headers.forEach(h => tr.append(node('th', h))); head.append(tr); table.append(head); const body = node('tbody'); for (const row of rows) {
        const tr = node('tr');
        row.forEach(v => tr.append(node('td', v)));
        body.append(tr);
    } table.append(body); parent.append(table); }
    setBoundTasks(tasks: Task[] | null, links: Snapshot['links'] = []) {
        const recipes = new Map(this.imported?.links.map(l => [JSON.stringify([l.taskId, l.element]), l]));
        links = links.map(l => { const saved = recipes.get(JSON.stringify([l.taskId, l.element])); return l.useImportedProfile && saved ? { ...l, profile: saved.profile, axis: saved.axis } : l; });
        this.bound = tasks ? { ...(this.imported ?? { name: 'Power BI schedule', currency: 'GBP', profiles: new Map(), resources: [], warnings: [] }), tasks, links } : undefined;
        const snapshot = this.snapshot;
        if (this.current.loaded && snapshot) {
            this.current.loaded.snapshot = { ...snapshot };
            this.current.relink();
        }
        if (!this.snapshot?.tasks.some(t => t.id === this.selected))
            this.selected = null;
        this.filters();
        this.bounds();
        this.renderData();
        this.apply();
    }
    message(text: string) { this.note.textContent = text; }
    setTextSize(size: number) { this.root.style.fontSize = `${Math.max(10, Math.min(20, Number.isFinite(size) ? size : 12))}px`; }
    resize() { this.current.resize(); this.baseline.resize(); }
    destroy() { this.destroyed = true; clearInterval(this.timer); this.current.destroy(); this.baseline.destroy(); this.root.remove(); }
}
