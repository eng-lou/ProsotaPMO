import * as THREE from 'three';
import { clipGuideToField, paintRoadWear, roadRoutes, type RoadWear } from './roadWear';
import type { WearGuide } from './surfaceWearGuides';
export interface FootprintEdges {
    fade: number;
    radius: number;
    endsOnly?: boolean;
    road?: RoadWear;
    guideMap?: Map<string, WearGuide>;
}
export const NO_FOOTPRINT_EDGES: FootprintEdges = { fade: 0, radius: 0 };
const LIMIT = 768;
const PAD = 3;
// Measure each connected patch independently. A material slot can contain
// both a broad pad and a separate strip less than a metre wide.
function footprintIslands(depth: Float32Array, w: number) {
    const labels = new Int32Array(depth.length);
    const queue = new Int32Array(depth.length);
    const islands = [{ deepest: 0, first: 0, last: 0 }];
    for (let i = 0; i < depth.length; i++) {
        if (!depth[i] || labels[i])
            continue;
        const id = islands.length;
        const patch = { deepest: 0, first: w, last: 0 };
        islands.push(patch);
        let head = 0, tail = 1;
        queue[0] = i;
        labels[i] = id;
        function visit(next: number) {
            if (depth[next] > 0 && !labels[next]) {
                labels[next] = id;
                queue[tail++] = next;
            }
        }
        while (head < tail) {
            const pixel = queue[head++], x = pixel % w;
            patch.deepest = Math.max(patch.deepest, depth[pixel]);
            patch.first = Math.min(patch.first, x);
            patch.last = Math.max(patch.last, x);
            // A border of PAD empty pixels surrounds the footprint.
            visit(pixel - 1);
            visit(pixel + 1);
            visit(pixel - w);
            visit(pixel + w);
        }
    }
    return { labels, islands };
}
// Squared Euclidean distance to the nearest seed. Each 1D pass builds the
// lower envelope of parabolas. Cost depends on pixels, not boundary segments.
function distances(seeds: Uint8Array, w: number, h: number) {
    const n = Math.max(w, h);
    const values = new Float64Array(n), centres = new Int32Array(n), splits = new Float64Array(n + 1);
    const data = Float32Array.from(seeds, v => v ? 0 : 1e10);
    function line(start: number, stride: number, count: number) {
        for (let q = 0; q < count; q++)
            values[q] = data[start + stride * q];
        let k = 0;
        centres[0] = 0;
        splits[0] = -Infinity;
        splits[1] = Infinity;
        for (let q = 1; q < count; q++) {
            let cross: number;
            for (;;) {
                const p = centres[k];
                cross = ((values[q] - values[p]) / (q - p) + q + p) * .5;
                if (cross > splits[k])
                    break;
                k--;
            }
            centres[++k] = q;
            splits[k] = cross;
            splits[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < count; q++) {
            while (splits[k + 1] < q)
                k++;
            const p = centres[k];
            data[start + stride * q] = (q - p) * (q - p) + values[p];
        }
    }
    for (let y = 0; y < h; y++)
        line(y * w, 1, w);
    for (let x = 0; x < w; x++)
        line(x, w, h);
    return data;
}
// Project the union of rendered triangles. Holes stay empty and shared
// triangle edges disappear. All distances use equal-sized pixels in metres.
export function footprintField(geometry: THREE.BufferGeometry, scale: THREE.Vector3, slot?: number, limit = LIMIT) {
    const pos = geometry.getAttribute('position');
    if (!pos?.count)
        return null;
    const index = geometry.index, count = index?.count ?? pos.count;
    const spans = (slot === undefined ? [{ start: 0, count }] : geometry.groups.filter(g => g.materialIndex === slot))
        .map(g => ({ start: Math.max(g.start, geometry.drawRange.start), end: Math.min(count, g.start + g.count, geometry.drawRange.start + geometry.drawRange.count) }));
    const bounds = new THREE.Box3(), vertex = new THREE.Vector3();
    for (const span of spans)
        for (let i = span.start; i < span.end; i++)
            bounds.expandByPoint(vertex.fromBufferAttribute(pos, index ? index.getX(i) : i));
    if (bounds.isEmpty())
        return null;
    const size = bounds.getSize(new THREE.Vector3());
    const axes = ([0, 1, 2] as const).slice().sort((a, b) => size.getComponent(b) * scale.getComponent(b) - size.getComponent(a) * scale.getComponent(a));
    const [u, v] = axes;
    const length = size.getComponent(u) * scale.getComponent(u), breadth = size.getComponent(v) * scale.getComponent(v);
    if (!(breadth > 0 && Number.isFinite(length)))
        return null;
    const pitch = Math.max(Math.min(.025, breadth / 16), length / (limit - 2 * PAD));
    const w = Math.ceil(length / pitch) + 2 * PAD, h = Math.ceil(breadth / pitch) + 2 * PAD;
    const xs = new Float64Array(pos.count), ys = new Float64Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
        xs[i] = (pos.getComponent(i, u) - bounds.min.getComponent(u)) * scale.getComponent(u) / pitch + PAD;
        ys[i] = (pos.getComponent(i, v) - bounds.min.getComponent(v)) * scale.getComponent(v) / pitch + PAD;
    }
    const outside = new Uint8Array(w * h).fill(1);
    // Scan triangle spans at texel centres. Unioning the spans also handles
    // both caps of an extrusion and meshes with duplicated seam vertices.
    for (const span of spans)
        for (let t = span.start; t + 2 < span.end; t += 3) {
            const ids = [index ? index.getX(t) : t, index ? index.getX(t + 1) : t + 1, index ? index.getX(t + 2) : t + 2];
            ids.sort((a, b) => ys[a] - ys[b]);
            const [a, b, c] = ids;
            for (let y = Math.ceil(ys[a] - .5); y < ys[c] - .5; y++) {
                const py = y + .5, low = py < ys[b] ? a : b, high = py < ys[b] ? b : c;
                const x0 = xs[a] + (py - ys[a]) * (xs[c] - xs[a]) / (ys[c] - ys[a]);
                const x1 = xs[low] + (py - ys[low]) * (xs[high] - xs[low]) / (ys[high] - ys[low]);
                outside.fill(0, y * w + Math.ceil(Math.min(x0, x1) - .5), y * w + Math.ceil(Math.max(x0, x1) - .5));
            }
        }
    const depth = distances(outside, w, h);
    let deepest = 0;
    for (let i = 0; i < depth.length; i++) {
        depth[i] = Math.max(0, Math.sqrt(depth[i]) - .5);
        deepest = Math.max(deepest, depth[i]);
    }
    function projection(axis: number, texels: number) {
        const factor = scale.getComponent(axis) / (pitch * texels);
        return new THREE.Vector4(0, 0, 0, PAD / texels - bounds.min.getComponent(axis) * factor).setComponent(axis, factor);
    }
    if (!deepest)
        return null;
    return { w, h, pitch, depth, ...footprintIslands(depth, w), u: projection(u, w), v: projection(v, h) };
}
type Field = NonNullable<ReturnType<typeof footprintField>>;
// An inward offset followed by a round outward offset rounds the actual
// footprint, including irregular pads. Radius and feather are independent.
export function footprintMask(field: Field, { fade, radius, endsOnly }: FootprintEdges) {
    const { depth, labels, islands, pitch, w, h } = field;
    const widths = islands.map(patch => {
        const available = endsOnly ? (patch.last - patch.first + 1) / 2 : patch.deepest;
        // Reserve an opaque middle even on narrow strips at the site's viewing distance.
        return Math.min(fade / pitch, available * .75);
    });
    const radii = islands.map(patch => Math.min(radius / pitch, patch.deepest));
    const coreDistance = radius >= pitch
        ? distances(Uint8Array.from(depth, (d, i) => Number(d > 0 && d >= radii[labels[i]])), w, h) : null;
    const pixels = new Uint8Array(w * h);
    for (let i = 0; i < depth.length; i++) {
        const id = labels[i];
        if (!id)
            continue;
        const patch = islands[id], x = i % w;
        const f = widths[id];
        const rounded = coreDistance ? radii[id] + .5 - Math.sqrt(coreDistance[i]) : Infinity;
        const inward = endsOnly ? Math.min(x - patch.first + .5, patch.last - x + .5)
            : coreDistance?.[i] === 0 ? depth[i] : Math.min(depth[i], rounded);
        const t = f > 0 ? THREE.MathUtils.clamp(inward / f, 0, 1) : 1;
        const corner = THREE.MathUtils.clamp(rounded + 1, 0, 1);
        pixels[i] = Math.round(255 * corner * t * t * (3 - 2 * t));
    }
    return pixels;
}
// Each opted-in surface owns its mask; the geometry and its authored UV
// channels remain untouched. The shader projects from the same local plane
// used to rasterise the footprint, including on the sides of a slab.
interface Binding {
    active: boolean;
    style: FootprintEdges;
    geometry?: THREE.BufferGeometry;
    slot?: number;
    limit?: number;
    positionVersion?: number;
    indexVersion?: number;
    scale: THREE.Vector3;
    field?: Field | null;
    applied: string;
    wearKey?: string;
    routes?: ReturnType<typeof roadRoutes>;
    guideMap?: Map<string, WearGuide>;
    guideTransform?: THREE.Matrix4;
    texture: THREE.DataTexture;
    grooveColour: THREE.Color;
    relief: {
        value: number;
    };
    core: {
        value: number;
    };
    fringe?: THREE.Material;
    u: THREE.Vector4;
    v: THREE.Vector4;
    shadows: Map<THREE.Mesh, () => void>;
    compile: THREE.Material['onBeforeCompile'];
    key: THREE.Material['customProgramCacheKey'];
    render: THREE.Material['onBeforeRender'];
    dispose: () => void;
}
const bindings = new WeakMap<THREE.Material, Binding>();
const worldScale = new THREE.Vector3();
function patchMask(shader: THREE.WebGLProgramParametersWithUniforms, b: Binding, shadow: boolean, fringe = false) {
    shader.uniforms.footprintU = { value: b.u };
    shader.uniforms.footprintV = { value: b.v };
    shader.uniforms.footprintMap = { value: b.texture };
    shader.uniforms.footprintCore = b.core;
    shader.uniforms.grooveColour = { value: b.grooveColour };
    shader.uniforms.grooveDepth = b.relief;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 footprintUv; uniform vec4 footprintU, footprintV;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nfootprintUv=vec2(dot(footprintU,vec4(position,1.)),dot(footprintV,vec4(position,1.)));');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 footprintUv; uniform sampler2D footprintMap; uniform float footprintCore, grooveDepth; uniform vec3 grooveColour;')
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n' + (shadow
        ? 'if(texture2D(footprintMap,footprintUv).r < .5) discard;'
        : `
        vec4 footprintDetail = texture2D(footprintMap, footprintUv);
        float footprintAlpha = footprintDetail.r;
        if (footprintAlpha <= 0.) discard;
        ${fringe ? 'if (footprintAlpha >= 1.) discard; diffuseColor.a *= footprintAlpha;' : `
        if (footprintCore > .5) {
            if (footprintAlpha < 1.) discard;
        } else {
            diffuseColor.a *= footprintAlpha;
        }`}`));
    if (!shadow) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
            float wheelWear = footprintDetail.g, tread = footprintDetail.b, hole = footprintDetail.a;
            vec3 wornEarth = grooveColour * (.72 + .7 * sqrt(max(0.,dot(diffuseColor.rgb,vec3(.21,.72,.07)))));
            diffuseColor.rgb = mix(diffuseColor.rgb, wornEarth, wheelWear * .76);
            diffuseColor.rgb *= 1. - grooveDepth * tread * 2.2 - abs(grooveDepth) * hole * 3.;
            #include <alphatest_fragment>`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            float wearHeight = -grooveDepth * (.71 * wheelWear + .55 * tread) - abs(grooveDepth) * 1.3 * hole;
            vec3 wx = dFdx(-vViewPosition), wy = dFdy(-vViewPosition);
            vec3 wr1 = cross(wy, normal), wr2 = cross(normal, wx);
            float wdet = dot(wx, wr1) * faceDirection;
            if (grooveDepth != 0. && abs(wdet) > 1e-12)
                normal = normalize(abs(wdet) * normal - sign(wdet) * (dFdx(wearHeight) * wr1 + dFdy(wearHeight) * wr2));`);
    }
}
// Ground slabs and native pads cast the rounded silhouette too. Keep an
// asset's authored shadow pass and independent material groups intact.
function bindGroundShadow(mesh: THREE.Mesh, b: Binding) {
    if (b.shadows.has(mesh) || Array.isArray(mesh.material) || mesh.customDepthMaterial || mesh.customDistanceMaterial)
        return;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), distance = new THREE.MeshDistanceMaterial();
    for (const pass of [depth, distance]) {
        pass.onBeforeCompile = shader => patchMask(shader, b, true);
        pass.customProgramCacheKey = () => 'ground-footprint-shadow-1';
    }
    mesh.customDepthMaterial = depth;
    mesh.customDistanceMaterial = distance;
    b.shadows.set(mesh, () => {
        if (mesh.customDepthMaterial === depth)
            mesh.customDepthMaterial = undefined;
        if (mesh.customDistanceMaterial === distance)
            mesh.customDistanceMaterial = undefined;
        depth.dispose();
        distance.dispose();
    });
}
function reliefMetres(wear?: RoadWear) {
    if (!wear) return 0;
    return (wear.mode === 'rough' ? -1 : 1) * wear.depthCm / 100;
}
// Keep the fully covered ground in the opaque queue. Submit only its feather
// to three's normal back-to-front transparency pass using the same mesh and
// draw group. This also keeps picking, exports and model hierarchies intact.
function queueFringe(renderer: THREE.WebGLRenderer, scene: THREE.Scene, mesh: THREE.Object3D,
    group: THREE.Group | null, source: THREE.Material, b: Binding) {
    const list = renderer.renderLists.get(scene, 0);
    const item = list.opaque.find(i => i.object === mesh && i.material === source && i.group === group);
    if (!item) return false;
    if (!b.fringe) {
        // Read live selection, clipping, maps, and lighting from the source.
        // A separate GPU material identity owns the blended shader/program.
        const identity = new THREE.Material();
        const rim: THREE.Material = Object.create(source, {
            id: Object.getOwnPropertyDescriptor(identity, 'id')!, uuid: {value: identity.uuid}, _listeners: {value: {}, writable:true},
        });
        rim.transparent = true;
        rim.depthWrite = false;
        rim.alphaToCoverage = false;
        rim.forceSinglePass = true;
        rim.customProgramCacheKey = () => source.customProgramCacheKey()+'-fringe';
        rim.onBeforeCompile = (shader, gl) => {
            b.compile.call(source, shader, gl);
            patchMask(shader, b, false, true);
        };
        b.fringe = rim;
    }
    const transparent = list.transparent;
    if (transparent.some(i => i.object === mesh && i.material === b.fringe && i.group === group)) return true;
    list.push(mesh, item.geometry, b.fringe, item.groupOrder, item.z, group);
    // The renderer already sorted the list before starting its opaque pass.
    if (renderer.sortObjects && transparent.length > 1) {
        const edge = transparent.pop()!;
        let at = transparent.length;
        while (at > 0) {
            const p = transparent[at-1];
            const order = p.groupOrder-edge.groupOrder || p.renderOrder-edge.renderOrder || edge.z-p.z || p.id-edge.id;
            if (order <= 0) break;
            at--;
        }
        transparent.splice(at,0,edge);
    }
    return true;
}
export function applyFootprintEdges(mat: THREE.Material, style: FootprintEdges) {
    const saved = bindings.get(mat);
    if (!style.fade && !style.radius && !style.road) {
        if (saved?.active) {
            saved.active = false;
            for (const restore of saved.shadows.values())
                restore();
            saved.shadows.clear();
            saved.geometry = undefined;
            saved.field = undefined;
            saved.routes = undefined;
            saved.wearKey = undefined;
            saved.guideMap = undefined;
            saved.relief.value = 0;
            saved.applied = '';
            saved.texture.dispose();
            saved.texture.image = { width: 1, height: 1, data: new Uint8Array([255, 0, 0, 0]) };
            saved.texture.needsUpdate = true;
        }
        return;
    }
    if (saved) {
        saved.active = true;
        saved.style = style;
        if (style.road)
            saved.grooveColour.set(style.road.colour);
        saved.relief.value = reliefMetres(style.road);
        return;
    }
    const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const b: Binding = { active: true, style, texture, core: {value:0}, grooveColour: new THREE.Color(style.road?.colour ?? 0), relief: { value: reliefMetres(style.road) }, u: new THREE.Vector4(), v: new THREE.Vector4(), scale: new THREE.Vector3(), applied: '', shadows: new Map(),
        compile: mat.onBeforeCompile, key: mat.customProgramCacheKey, render: mat.onBeforeRender, dispose: () => {
            for (const restore of b.shadows.values())
                restore();
            b.shadows.clear();
            mat.onBeforeCompile = b.compile;
            mat.customProgramCacheKey = b.key;
            mat.onBeforeRender = b.render;
            b.fringe?.dispose();
            mat.removeEventListener('dispose', b.dispose);
            texture.dispose();
            bindings.delete(mat);
            mat.needsUpdate = true;
        } };
    bindings.set(mat, b);
    const baseKey = b.key.call(mat);
    mat.customProgramCacheKey = () => baseKey + '-footprint-blend';
    mat.onBeforeCompile = function (shader, renderer) {
        b.compile.call(this, shader, renderer);
        patchMask(shader, b, false);
    };
    mat.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
        b.render.call(this, renderer, scene, camera, geometry, object, group);
        const solid = b.active && (b.style.fade > 0 || b.style.radius > 0) && !this.transparent && this.depthWrite && this.opacity >= 1;
        if (this !== b.fringe) b.core.value = solid && queueFringe(renderer,scene,object,group,mat,b) ? 1 : 0;
        if (!b.active)
            return;
        if ((b.style.fade || b.style.radius) && object instanceof THREE.Mesh && object.castShadow)
            bindGroundShadow(object, b);
        worldScale.setFromMatrixScale(object.matrixWorld);
        const pos = geometry.getAttribute('position');
        const pv = pos && ('version' in pos ? pos.version : pos.data.version);
        // three passes a BufferGeometry draw group here (its type declaration says Object3D.Group).
        const slot = object instanceof THREE.Mesh && Array.isArray(object.material) && group && 'materialIndex' in group
            && typeof group.materialIndex === 'number' ? group.materialIndex : undefined;
        const limit = b.style.road ? 1280 : LIMIT;
        if (b.geometry !== geometry || b.slot !== slot || b.limit !== limit || b.scale.distanceToSquared(worldScale) > 1e-12 || b.positionVersion !== pv || b.indexVersion !== geometry.index?.version) {
            b.geometry = geometry;
            b.slot = slot;
            b.limit = limit;
            b.scale.copy(worldScale);
            b.positionVersion = pv;
            b.indexVersion = geometry.index?.version;
            b.field = footprintField(geometry, worldScale, slot, limit);
            b.applied = '';
            b.routes = undefined;
            b.wearKey = undefined;
            if (b.field) {
                b.u.copy(b.field.u);
                b.v.copy(b.field.v);
            }
        }
        const signature = b.style.fade + '/' + b.style.radius + '/' + !!b.style.endsOnly;
        const wear = b.style.road;
        const guided = wear && (wear.guides.length > 0 || !!wear.area);
        if (guided && (b.guideMap !== b.style.guideMap || !b.guideTransform?.equals(object.matrixWorld))) {
            b.guideMap = b.style.guideMap;
            (b.guideTransform ??= new THREE.Matrix4()).copy(object.matrixWorld);
            b.wearKey = undefined;
        }
        const wearKey = wear ? [wear.mode, wear.pairs, wear.wander, wear.potholes, wear.roughness, wear.area, ...wear.guides].join('/') : '';
        if (b.applied !== signature || b.wearKey !== wearKey) {
            const fld = b.field;
            // Replace the GPU allocation as well when a regenerated mesh changes size.
            const w = fld?.w ?? 1, h = fld?.h ?? 1;
            if (texture.image.width !== w || texture.image.height !== h) {
                texture.dispose();
                texture.image = { width: w, height: h, data: new Uint8Array(w * h * 4) };
            }
            const pixels = texture.image.data as Uint8Array;
            if (b.applied !== signature) {
                const mask = fld && (b.style.fade || b.style.radius) ? footprintMask(fld, b.style) : undefined;
                for (let i = 0; i < w * h; i++)
                    pixels[4 * i] = mask ? mask[i] : 255;
            }
            if (b.wearKey !== wearKey) {
                for (let i = 0; i < w * h; i++) {
                    pixels[4 * i + 1] = 0;
                    pixels[4 * i + 2] = 0;
                    pixels[4 * i + 3] = 0;
                }
                if (fld && wear) {
                    const inverse = guided ? object.matrixWorld.clone().invert() : null;
                    const project = (id: string) => (b.style.guideMap?.get(id)?.points ?? []).map(world => {
                        const p = world.clone().applyMatrix4(inverse!);
                        const uv = new THREE.Vector4(p.x, p.y, p.z, 1);
                        return { x: uv.dot(fld.u) * w - .5, y: uv.dot(fld.v) * h - .5 };
                    });
                    let routes: ReturnType<typeof roadRoutes> = [];
                    if (wear.mode === 'tracks' && wear.pairs > 0) {
                        routes = wear.guides.length ? wear.guides.flatMap(id => clipGuideToField(project(id), fld)) : (b.routes ??= roadRoutes(fld));
                    }
                    const boundary = wear.area && !b.style.guideMap?.get(wear.area)?.closed ? [] : undefined;
                    paintRoadWear(fld, routes, wear, pixels, wear.area ? boundary ?? project(wear.area) : undefined);
                }
                b.wearKey = wearKey;
            }
            texture.needsUpdate = true;
            b.applied = signature;
        }
    };
    mat.addEventListener('dispose', b.dispose);
    mat.needsUpdate = true;
}
