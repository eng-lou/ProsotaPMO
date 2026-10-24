import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ResolvedTimelineLink } from './timelinePlayback'
import { applySiteAnimation, type SiteMaterialOriginal } from './siteAnimationRender'

export function useSiteAnimation(root: React.RefObject<THREE.Group>, base: THREE.Vector3, links: ResolvedTimelineLink[],
  hasLinks: boolean, dateRef: React.MutableRefObject<Date | null>, preview: boolean, legacyVisible: () => boolean) {
  const originals = useRef(new WeakMap<THREE.Material, SiteMaterialOriginal>())
  useFrame(() => {
    if (root.current) applySiteAnimation(root.current, base, links, hasLinks, dateRef.current, preview, legacyVisible(), originals.current)
  })
}
