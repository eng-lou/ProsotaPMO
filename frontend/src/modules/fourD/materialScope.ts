import type { RealisticMaterialMap } from './realisticMaterials'

// A saved project's original, unprefixed keys remain its defaults. Scoped
// entries sit beside them, so old projects need no migration.
export type MaterialTarget = readonly string[]
const prefix = (owner: string) => '@' + encodeURIComponent(owner) + '/'
const index = new WeakMap<RealisticMaterialMap, Map<string, RealisticMaterialMap>>()

export function materialScope(mapping: RealisticMaterialMap, owner: string): RealisticMaterialMap {
  let children = index.get(mapping)
  if (!children) {
    children = new Map()
    for (const key of Object.keys(mapping)) {
      if (!key.startsWith('@')) continue
      const end = key.indexOf('/')
      if (end < 0) continue
      const scope = key.slice(0, end + 1)
      let child = children.get(scope)
      if (!child) {
        child = Object.create(mapping) as RealisticMaterialMap
        children.set(scope, child)
      }
      child[key.slice(end + 1)] = mapping[key]
    }
    index.set(mapping, children)
  }
  return children.size ? children.get(prefix(owner)) ?? mapping : mapping
}

export function mappingAtTarget(mapping: RealisticMaterialMap, target: MaterialTarget) {
  return target.reduce(materialScope, mapping)
}

// Empty values explicitly request Auto / no tint / default tiling even
// when a project default exists. Reset removes the local value to inherit it.
export function editMaterialFields(mapping: RealisticMaterialMap, targets: readonly MaterialTarget[],
  fields: Record<string, string | null> | ((current: RealisticMaterialMap) => Record<string, string | null>), reset = false): RealisticMaterialMap {
  const next: Record<string, string> = { ...mapping }
  for (const target of targets) {
    const scope = target.map(prefix).join('')
    for (const [field, value] of Object.entries(typeof fields === 'function' ? fields(mappingAtTarget(mapping, target)) : fields)) {
      const key = scope + field
      if (reset || (!scope && value === null)) delete next[key]
      else next[key] = value ?? ''
    }
  }
  return next as RealisticMaterialMap
}
