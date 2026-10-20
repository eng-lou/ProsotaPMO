import powerbi from 'powerbi-visuals-api';
import { FormattingSettingsService } from 'powerbi-visuals-utils-formattingmodel';
import { VisualFormattingSettingsModel } from './settings';
import { Dashboard } from './dashboard';
import { readTable } from './bindings';
import { embeddedSnapshot } from './embeddedSnapshot';
import '../style/visual.less';
export class Visual implements powerbi.extensibility.visual.IVisual {
    private dashboard: Dashboard;
    private table?: powerbi.DataViewTable;
    private selections: powerbi.extensibility.ISelectionManager;
    private options: powerbi.extensibility.visual.VisualConstructorOptions;
    private formatting = new FormattingSettingsService();
    private settings = new VisualFormattingSettingsModel();
    private truncated = false;
    private snapshotPayload = '';
    private destroyed = false;
    constructor(options?: powerbi.extensibility.visual.VisualConstructorOptions) {
        if (!options)
            throw new Error('Power BI visual host is required.');
        this.options = options;
        this.dashboard = new Dashboard(options.element);
        this.selections = options.host.createSelectionManager();
        this.dashboard.onSelect = task => {
            if (!options.host.hostCapabilities.allowInteractions || !this.table)
                return;
            const column = this.table.columns.findIndex(c => c.roles?.taskId);
            const row = (this.table.rows ?? []).findIndex(r => String(r[column]) === task.id);
            if (row >= 0)
                void this.selections.select(options.host.createSelectionIdBuilder().withTable(this.table, row).createSelectionId());
        };
        this.dashboard.onClear = () => { if (options.host.hostCapabilities.allowInteractions)
            void this.selections.clear(); };
        this.dashboard.onLoaded = () => this.bind();
    }
    update(options: powerbi.extensibility.visual.VisualUpdateOptions) {
        this.options.host.eventService.renderingStarted(options);
        try {
            const view = options.dataViews?.[0];
            const snapshot = view?.metadata.objects?.prosotaSnapshot;
            const payload = snapshot?.data;
            if (typeof payload === 'string' && payload && payload !== this.snapshotPayload) {
                this.snapshotPayload = payload;
                void embeddedSnapshot(payload, String(snapshot?.name || 'Prosota.ifc'))
                    .then(file => { if (!this.destroyed && this.snapshotPayload === payload) return this.dashboard.open(file, 'current', true); })
                    .catch(error => { if (!this.destroyed) this.dashboard.message(`Could not open embedded IFC: ${String(error)}`); });
            }
            this.table = view?.table;
            this.truncated = !!view?.metadata.segment;
            if (view)
                this.settings = this.formatting.populateFormattingSettingsModel(VisualFormattingSettingsModel, view);
            this.dashboard.setTextSize(this.settings.display.fontSize.value);
            this.bind();
            this.dashboard.resize();
            this.options.host.eventService.renderingFinished(options);
        }
        catch (e) {
            this.dashboard.message(String(e));
            this.options.host.eventService.renderingFailed(options, String(e));
        }
    }
    private bind() {
        try {
            if (this.truncated)
                throw new Error('Power BI returned only part of this dataset. Filter to fewer than 30,000 rows before reviewing totals.');
            if (!this.table || !this.table.columns.some(c => c.roles?.taskId)) {
                this.dashboard.setBoundTasks(null);
                return;
            }
            const result = readTable(this.table);
            this.dashboard.setBoundTasks(result.tasks, result.links);
        }
        catch (e) {
            this.dashboard.setBoundTasks([]);
            this.dashboard.message(e instanceof Error ? e.message : String(e));
        }
    }
    getFormattingModel() { return this.formatting.buildFormattingModel(this.settings); }
    destroy() { this.destroyed = true; this.dashboard.destroy(); }
}
