import * as W from 'web-ifc';
import * as T from 'three';
import { DEFAULT_ANIMATION_CONFIG } from './generated/animation';
import { readProfile } from './profile';
import { readStepTextProperties } from './stepText';
import { wasmURI } from './generated/wasm';
import { Snapshot, parseTask, numberOrNull, Profile } from './types';
export interface Loaded {
    snapshot: Snapshot;
    group: T.Group;
    elements: Map<string, T.Group>;
    dispose(): void;
}
const raw = (v: any): any => v && typeof v === 'object' && 'value' in v ? v.value : v;
function decoded(v: any): any { const value = raw(v); if (typeof value !== 'string')
    return value; try {
    return JSON.parse(value);
}
catch {
    return value;
} }
export async function loadIfc(bytes: Uint8Array, name: string, progress: (message: string) => void): Promise<Loaded> {
    const api = new W.IfcAPI();
    await api.Init(() => wasmURI, true);
    const group = new T.Group(), elements = new Map<string, T.Group>();
    const dispose = () => group.traverse(o => { if (o instanceof T.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    } });
    let model: number | undefined;
    try {
        model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
        if (model < 0)
            throw new Error('Unable to open this IFC.');
        const snapshot: Snapshot = { name, currency: 'GBP', tasks: [], profiles: new Map(), links: [], resources: [], warnings: [] };
        const fullText = readStepTextProperties(new TextDecoder().decode(bytes));
        const props = api.GetLineIDsWithType(model, W.IFCPROPERTYSET);
        const linkRecords: any[] = [], assignmentRecords: any[] = [];
        for (let i = 0; i < props.size(); i++) {
            const p = api.GetLine(model, props.get(i)), label = raw(p.Name);
            if (typeof label !== 'string' || !label.startsWith('Prosota_'))
                continue;
            const values: Record<string, any> = {};
            for (const ref of p.HasProperties ?? []) {
                const item = api.GetLine(model, ref.value);
                values[raw(item.Name)] = decoded(fullText.get(ref.value) ?? item.NominalValue);
            }
            if (label === 'Prosota_Activity') {
                if (['project', 'wbs', 'wbs_summary'].includes(values.activity_type))
                    continue;
                const task = parseTask(values);
                if (task)
                    snapshot.tasks.push(task);
            }
            else if (label === 'Prosota_Animation') {
                if (!Array.isArray(values.profiles))
                    throw new Error('Invalid Prosota animation metadata.');
                for (const profile of values.profiles)
                    if (profile.id && profile.config)
                        snapshot.profiles.set(profile.id, readProfile(profile.config));
            }
            else if (label === 'Prosota_ModelLinks') {
                if (!Array.isArray(values.links))
                    throw new Error('Invalid Prosota model-link metadata.');
                linkRecords.push(...values.links);
            }
            else if (label.startsWith('Prosota_ResourceAssignment'))
                assignmentRecords.push(values);
            else if (label === 'Prosota_Export')
                snapshot.currency = String(values.currency ?? 'GBP');
        }
        snapshot.tasks = [...new Map(snapshot.tasks.map(t => [t.id, t])).values()];
        const tasks = new Map(snapshot.tasks.map(t => [t.id, t]));
        for (const l of linkRecords) {
            const task = tasks.get(l.activity_id);
            if (!task || l.source_kind !== 'ifc')
                continue;
            const profileId = l.animation_profile_id ?? task.profileId;
            const profile: Profile = profileId ? snapshot.profiles.get(profileId) ?? DEFAULT_ANIMATION_CONFIG : DEFAULT_ANIMATION_CONFIG;
            if (profileId && !snapshot.profiles.has(profileId))
                snapshot.warnings.push(`Missing profile ${profileId}; using Default.`);
            snapshot.links.push({ taskId: task.id, element: String(l.element_ref), startMs: task.start, finishMs: task.finish, profile, axis: profile.axis });
        }
        const seen = new Set<string>();
        for (const r of assignmentRecords) {
            const a = r.assignment;
            if (!a || seen.has(a.id))
                continue;
            seen.add(a.id);
            snapshot.resources.push({ id: a.id, taskId: a.activity_id, name: r.name ?? a.resource_name ?? 'Resource', hours: (['labour','equipment','crew'].includes(r.resource_type ?? a.resource_type) ? numberOrNull(a.planned_hours ?? a.budgeted_hours ?? a.budgeted_units ?? a.planned_units) : null), cost: numberOrNull(a.budget) });
        }
        progress('Reading IFC geometry…');
        let count = 0;
        api.StreamAllMeshes(model, mesh => {
            const line = api.GetLine(model!, mesh.expressID), guid = String(raw(line.GlobalId) ?? mesh.expressID);
            const element = new T.Group();
            element.userData.guid = guid;
            for (let i = 0; i < mesh.geometries.size(); i++) {
                const placed = mesh.geometries.get(i), geometry = api.GetGeometry(model!, placed.geometryExpressID);
                const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
                const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize()).slice();
                const positions = new Float32Array(vertices.length / 2), normals = new Float32Array(vertices.length / 2);
                for (let j = 0, k = 0; j < vertices.length; j += 6, k += 3) {
                    positions.set(vertices.subarray(j, j + 3), k);
                    normals.set(vertices.subarray(j + 3, j + 6), k);
                }
                const buffer = new T.BufferGeometry();
                buffer.setAttribute('position', new T.BufferAttribute(positions, 3));
                buffer.setAttribute('normal', new T.BufferAttribute(normals, 3));
                buffer.setIndex(new T.BufferAttribute(indices, 1));
                const c = placed.color, material = new T.MeshStandardMaterial({ color: new T.Color(c.x, c.y, c.z), opacity: c.w, transparent: c.w < 1, side: T.DoubleSide, roughness: 0.85 });
                material.userData.originalColor = material.color.clone();
                material.userData.originalOpacity = c.w;
                const object = new T.Mesh(buffer, material);
                object.applyMatrix4(new T.Matrix4().fromArray(placed.flatTransformation));
                element.add(object);
                geometry.delete();
            }
            if (elements.has(guid))
                throw new Error('Duplicate IFC GlobalId: ' + guid + '. Export a model with unique IDs before linking a schedule.');
            elements.set(guid, element);
            group.add(element);
            count++;
        });
        if (!count)
            throw new Error('This IFC contains no renderable geometry.');
        // Centre each part's pivot without changing its world-space placement.
        for (const element of elements.values()) {
            const centre = new T.Box3().setFromObject(element).getCenter(new T.Vector3());
            element.position.copy(centre);
            for (const child of element.children)
                child.position.sub(centre);
            element.userData.rest = centre.clone();
        }
        if (!snapshot.tasks.length)
            snapshot.warnings.push('No Prosota schedule found. Geometry is available; bind schedule fields in Power BI or use an integrated Prosota IFC.');
        const missing = snapshot.links.filter(l => !elements.has(l.element)).length;
        if (!snapshot.links.length && snapshot.tasks.length)
            snapshot.warnings.push('No task-to-model assignments found in this IFC.');
        if (missing)
            snapshot.warnings.push(`${missing} schedule links have no matching IFC geometry.`);
        return { snapshot, group, elements, dispose };
    }
    catch (error) {
        dispose();
        throw error;
    }
    finally {
        if (model !== undefined && model >= 0)
            api.CloseModel(model);
        api.Dispose();
    }
}
