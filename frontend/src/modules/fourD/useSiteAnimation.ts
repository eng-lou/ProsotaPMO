import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { ResolvedTimelineLink } from './timelinePlayback'
import { applySiteAnimation, type SiteMaterialOriginal } from './siteAnimationRender'
import { beginViewportWork, endViewportWork } from './viewportFrameMetrics'

export function useSiteAnimation(root: React.RefObject<THREE.Group>, base: THREE.Vector3, links: ResolvedTimelineLink[],
  hasLinks: boolean, dateRef: React.MutableRefObject<Date | null>, preview: boolean, legacyVisible: () => boolean, inherited = false) {
  const originals = useRef(new WeakMap<THREE.Material, SiteMaterialOriginal>())
  const renderer = useThree(s => s.gl)
  useFrame(() => {
    // Scatter children inherit their parent's animation; resetting their
    // materials here fights parent fades and repeatedly changes shader state.
    if (inherited) return
    const workStarted = beginViewportWork(renderer)
    let operational=false
    for(let n:THREE.Object3D|null=root.current;n;n=n.parent)if(n.userData.simulatorOwnsPose){operational=true;break}
    if (root.current) applySiteAnimation(root.current, base, links, hasLinks, operational?null:dateRef.current, preview||operational, legacyVisible(), originals.current)
    endViewportWork(renderer, 'Site', workStarted)
  })
}
