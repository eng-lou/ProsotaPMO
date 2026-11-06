import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ResolvedTimelineLink } from './timelinePlayback'
import { applySiteAnimation, type SiteMaterialOriginal } from './siteAnimationRender'

export function useSiteAnimation(root: React.RefObject<THREE.Group>, base: THREE.Vector3, links: ResolvedTimelineLink[],
  hasLinks: boolean, dateRef: React.MutableRefObject<Date | null>, preview: boolean, legacyVisible: () => boolean) {
  const originals = useRef(new WeakMap<THREE.Material, SiteMaterialOriginal>())
  useFrame(() => {
    let operational=false
    for(let n:THREE.Object3D|null=root.current;n;n=n.parent)if(n.userData.simulatorOwnsPose){operational=true;break}
    if (root.current) applySiteAnimation(root.current, base, links, hasLinks, operational?null:dateRef.current, preview||operational, legacyVisible(), originals.current)
  })
}
