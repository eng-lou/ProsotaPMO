import { pickActiveLink } from './generated/animation';
import { Viewer } from './viewer';
import { loadIfc } from './ifc';
import { Snapshot, Task, total } from './types';
const dateLabel = (v: number) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; }
export class Dashboard {
    readonly current: Viewer;
    readonly baseline: Viewer;
    private root: HTMLElement;
    private note: HTMLElement;
    private range: HTMLInputElement;
    private date: HTMLElement;
    private kpis: HTMLElement;
    private schedule: HTMLElement;
    private details: HTMLElement;
    private resources: HTMLElement;
    private costs: HTMLElement;
    private title: HTMLElement;
    private baselinePane: HTMLElement;
    private level: HTMLSelectElement;
    private discipline: HTMLSelectElement;
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
            this.now = this.min; play.textContent = 'Pause'; this.timer = setInterval(() => { this.now = Math.min(this.max, this.now + (this.max - this.min) / 240); this.syncDate(); if (this.now >= this.max)
            this.stop(play); }, 100); });
        this.range = node('input');
        this.range.type = 'range';
        this.range.min = '0';
        this.range.max = '1000';
        this.range.setAttribute('aria-label', 'Sequence date');
        this.range.oninput = () => { this.now = this.min + (this.max - this.min) * Number(this.range.value) / 1000; this.syncDate(); };
        this.date = node('span');
        playback.append(this.range, this.date);
        this.toggle(playback, 'Respect Prosota profiles', true, v => { this.useProfiles = v; this.apply(); });
        model.append(playback);
        const side = node('div', '', 'side');
        this.schedule = this.panel(side, 'Schedule');
        this.details = this.panel(side, 'Selected activity');
        main.append(model, side);
        this.root.append(main);
        const lower = node('div', '', 'lower-grid');
        this.resources = this.panel(lower, 'Resource assignments');
        this.costs = this.panel(lower, 'Cost performance');
        this.root.append(lower);
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
    async open(file: File, kind: 'current' | 'baseline') {
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
    private syncDate() { this.range.value = String((this.now - this.min) / (this.max - this.min) * 1000); this.date.textContent = dateLabel(this.now); for (const line of this.schedule?.querySelectorAll<HTMLElement>('.date-line') ?? [])
        line.style.left = `${(this.now - this.min) / (this.max - this.min) * 100}%`; this.apply(); }
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
        this.schedule.replaceChildren();
        if (!tasks.length)
            this.schedule.append(node('p', 'Open a Prosota integrated IFC or bind schedule fields.', 'muted'));
        const tick = node('div', `${dateLabel(this.min)} — ${dateLabel(this.max)}`, 'muted');
        this.schedule.append(tick);
        for (const task of tasks) {
            const row = node('div', '', 'gantt-row');
            const b = this.button(row, task.name, () => this.select(task.id));
            b.title = task.code;
            const lane = node('div', '', 'lane');
            const mark = node('span', '', 'current-bar');
            mark.style.left = `${(task.start - this.min) / (this.max - this.min) * 100}%`;
            mark.style.width = `${Math.max(.5, (task.finish - task.start) / (this.max - this.min) * 100)}%`;
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
            this.schedule.append(row);
        }
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
            const old = byResource.get(r.name);
            byResource.set(r.name, r.cost === null || old === null ? null : (old ?? 0) + r.cost);
        }
        this.bars(this.resources, [...byResource].map(([label, value]) => ({ label, value, color: '#3984fc' })));
        this.table(this.resources, ['Resource', 'Budget'], [...byResource].map(([name, cost]) => [name, this.money(cost)]));
        if (!rows.length)
            this.resources.append(node('p', 'No resource assignments in this selection.', 'muted'));
        this.costs.replaceChildren();
        const costTasks = tasks.filter(t => scope.has(t.id));
        this.bars(this.costs, ([['Budget','budget','#3984fc'],['Planned value','planned','#6574d7'],['Earned value','earned','#0bb2b7'],['Actual cost','actual','#efa900']] as const).map(([label,key,color])=>({label:costTasks.some(t=>t[key]===null)?`${label} (known)`:label,value:total(costTasks.filter(t=>t[key]!==null),key),color})));
        this.table(this.costs, ['Activity', 'Budget', 'Earned', 'Actual'], tasks.filter(t => scope.has(t.id)).map(t => [t.name, this.money(t.budget), this.money(t.earned), this.money(t.actual)]));
        this.costs.append(node('p', 'Snapshot totals. Missing values are shown as —; known KPI totals exclude them.', 'muted'));
    }
    private bars(parent: HTMLElement, values: {
        label: string;
        value: number | null;
        color: string;
    }[]) {
        const chart = node('div', '', 'bar-chart');
        const max = Math.max(1, ...values.map(v => Math.abs(v.value ?? 0)));
        for (const v of values) {
            const row = node('div', '', 'metric-row');
            row.append(node('span', v.label));
            const track = node('div', '', 'metric-track'), bar = node('div', '', 'metric-bar');
            bar.style.width = `${Math.abs(v.value ?? 0) / max * 100}%`;
            bar.style.background = v.color;
            track.append(bar);
            row.append(track, node('strong', this.money(v.value)));
            chart.append(row);
        }
        parent.append(chart);
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
