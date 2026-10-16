import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('src/generated', { recursive: true });
// Bundle the real Prosota engine, not a separate approximation of its recipes.
await build({ stdin: { contents: `export { computeAppliedAnimationStateAt, pickActiveLink } from '../frontend/src/modules/fourD/timelinePlayback'; export { DEFAULT_ANIMATION_CONFIG } from '../frontend/src/modules/fourD/animationDefaults';`, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', treeShaking: true, outfile: 'src/generated/animation.js', tsconfig: '../frontend/tsconfig.json' });
await writeFile('src/generated/animation.d.ts', `import { Profile, Link } from '../types'; export const DEFAULT_ANIMATION_CONFIG: Profile; export function pickActiveLink(links: Link[], now: Date): Link | null; export function computeAppliedAnimationStateAt(link: Link, now: Date, upAxis: 'y' | 'z'): {positionOffset: [number,number,number]; rotationOffsetDeg:number; scaleMultiplier:number; opacity:number; color:string|null; growProgress:number|null};`);
const wasm = await readFile('node_modules/web-ifc/web-ifc.wasm');
await writeFile('src/generated/wasm.ts', `export const wasmURI = 'data:application/wasm;base64,${wasm.toString('base64')}';\n`);
