import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assignStagger } from './stagger';
import { Loaded } from './ifc';
import { Link } from './types';
import { computeAppliedAnimationStateAt, pickActiveLink } from './generated/animation';
export class Viewer {
    readonly scene = new T.Scene();
    readonly camera = new T.PerspectiveCamera(40, 1, 0.01, 1e8);
    readonly renderer: T.WebGLRenderer;
    readonly controls: OrbitControls;
    loaded?: Loaded;
    origin = new T.Vector3();
    private observer: ResizeObserver;
    private byElement = new Map<string, Link[]>();
    private box?: T.Box3;
    private down = [0, 0];
    onCamera?: () => void;
    onSelect?: (guid: string) => void;
    constructor(private host: HTMLElement) {
        this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.localClippingEnabled = true;
        this.renderer.setClearColor('#eef2f7');
        host.append(this.renderer.domElement);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.addEventListener('change', () => { this.render(); this.onCamera?.(); });
        this.scene.add(new T.HemisphereLight(0xffffff, 0x718096, 2.5));
        const light = new T.DirectionalLight(0xffffff, 3);
        light.position.set(20, 40, 15);
        this.scene.add(light);
        this.camera.position.set(20, 20, 20);
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(host);
        this.renderer.domElement.addEventListener('pointerdown', e => this.down = [e.clientX, e.clientY]);
        this.renderer.domElement.addEventListener('pointerup', e => {
            if (Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 4 || !this.loaded)
                return;
            const r = this.renderer.domElement.getBoundingClientRect(), ray = new T.Raycaster();
            ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), this.camera);
            const hit = ray.intersectObjects(this.loaded.group.children, true).find(h => h.object.parent?.visible && (h.object as T.Mesh).material && ((h.object as T.Mesh).material as T.MeshStandardMaterial).opacity > 0.05);
            if (hit)
                this.onSelect?.(String(hit.object.parent?.userData.guid));
        });
    }
    setModel(model: Loaded, origin?: T.Vector3) {
        if (this.loaded) {
            this.scene.remove(this.loaded.group);
            this.loaded.dispose();
        }
        this.loaded = model;
        this.box = new T.Box3().setFromObject(model.group);
        this.origin.copy(origin ?? this.box.getCenter(new T.Vector3()));
        model.group.position.copy(this.origin).negate();
        this.scene.add(model.group);
        this.relink();
        this.frame();
    }
    rebase(origin: T.Vector3) { this.origin.copy(origin); if (this.loaded)
        this.loaded.group.position.copy(origin).negate(); this.render(); }
    relink() { if (this.loaded)
        assignStagger(this.loaded.snapshot.links, this.loaded.elements); this.byElement.clear(); for (const l of this.loaded?.snapshot.links ?? []) {
        const a = this.byElement.get(l.element) ?? [];
        a.push(l);
        this.byElement.set(l.element, a);
    } }
    frame() {
        if (!this.loaded) return;
        const box = new T.Box3().setFromObject(this.loaded.group), centre = box.getCenter(new T.Vector3());
        const size = box.getSize(new T.Vector3()).length() || 10;
        const direction = new T.Vector3(1, .75, 1).normalize();
        const right = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), direction).normalize();
        const up = new T.Vector3().crossVectors(direction, right).normalize();
        const tanV = Math.tan(this.camera.fov * Math.PI / 360), tanH = tanV * this.camera.aspect;
        let distance = 0;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
            const offset = new T.Vector3(x, y, z).sub(centre), depth = offset.dot(direction);
            distance = Math.max(distance, depth + Math.abs(offset.dot(right)) / tanH, depth + Math.abs(offset.dot(up)) / tanV);
        }
        this.controls.target.copy(centre);
        this.camera.position.copy(centre).addScaledVector(direction, Math.max(distance * 1.15, .1));
        this.camera.near = Math.max(size / 10000, .001); this.camera.far = size * 100;
        this.camera.updateProjectionMatrix(); this.controls.update(); this.render();
    }
    copyCamera(other: Viewer) { this.camera.position.copy(other.camera.position); this.camera.quaternion.copy(other.camera.quaternion); this.camera.near = other.camera.near; this.camera.far = other.camera.far; this.controls.target.copy(other.controls.target); this.camera.updateProjectionMatrix(); this.render(); }
    resize() { const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h)
        return; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.render(); }
    apply(date: number, profiles: boolean, selected: string | null, isolate: boolean, scope?: Set<string>) {
        if (!this.loaded)
            return;
        const now = new Date(date);
        for (const [guid, element] of this.loaded.elements) {
            const links = this.byElement.get(guid) ?? [], link = pickActiveLink(links, now);
            const inScope = !scope || !links.length || links.some(l => scope.has(l.taskId));
            element.visible = inScope && (!isolate || !selected || links.some(l => l.taskId === selected));
            element.position.copy(element.userData.rest);
            element.rotation.set(0, 0, 0);
            element.scale.setScalar(1);
            const state = link && profiles ? computeAppliedAnimationStateAt(link, now, 'z') : null;
            let opacity = 1;
            if (state) {
                element.position.add(new T.Vector3(...state.positionOffset));
                const axis = link!.axis === 'z' ? 'y' : link!.axis === 'y' ? 'z' : 'x';
                element.rotation[axis] = state.rotationOffsetDeg * Math.PI / 180 * (link!.axis === 'y' ? -1 : 1);
                element.scale.setScalar(state.scaleMultiplier);
                opacity = state.opacity;
            }
            else if (link)
                opacity = date < link.startMs ? 0 : 1;
            element.updateMatrixWorld(true);
            let plane: T.Plane | undefined;
            if (state?.growProgress != null && state.growProgress < 1) {
                const axis = link!.axis === 'z' ? 'y' : link!.axis === 'y' ? 'z' : 'x';
                const box = new T.Box3().setFromObject(element), dir = link!.profile.direction;
                const n = new T.Vector3();
                n[axis] = dir === 1 ? -1 : 1;
                const at = dir === 1 ? box.min[axis] + (box.max[axis] - box.min[axis]) * state.growProgress : box.max[axis] - (box.max[axis] - box.min[axis]) * state.growProgress;
                plane = new T.Plane(n, -n[axis] * at);
            }
            element.traverse(o => {
                if (!(o instanceof T.Mesh))
                    return;
                const m = o.material as T.MeshStandardMaterial;
                m.opacity = opacity * m.userData.originalOpacity;
                m.transparent = m.opacity < 1;
                m.depthWrite = m.opacity > .95;
                m.clippingPlanes = plane ? [plane] : [];
                m.color.copy(m.userData.originalColor);
                if (state?.color)
                    m.color.set(state.color);
                m.emissive.set(selected && links.some(l => l.taskId === selected) ? '#143e68' : '#000000');
            });
        }
        this.render();
    }
    render() { this.renderer.render(this.scene, this.camera); }
    destroy() { this.observer.disconnect(); this.controls.dispose(); this.loaded?.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
