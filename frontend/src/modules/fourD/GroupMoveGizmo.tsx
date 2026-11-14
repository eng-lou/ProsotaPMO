import { useLayoutEffect, useMemo, useRef } from 'react'
import { Group, Vector3 } from 'three'
import { TransformControls } from '@react-three/drei'
import { beginGroupMove, groupCentre, translateGroup, type GroupMove, type MoveTarget } from './groupMove'

export function GroupMoveGizmo({ targets, revision, onStart, onCommit, onBegin = beginGroupMove }: {
  onBegin?: (targets: MoveTarget[]) => GroupMove
  targets: MoveTarget[]; revision: number; onStart(): void; onCommit(move: GroupMove): void
}) {
  const pivot = useMemo(() => new Group(), [])
  const gesture = useRef<{ move: GroupMove; origin: Vector3 } | null>(null)
  useLayoutEffect(() => {
    if (!gesture.current) pivot.position.copy(groupCentre(targets))
  }, [pivot, targets, revision])
  useLayoutEffect(() => () => {
    if (gesture.current) translateGroup(gesture.current.move, new Vector3())
    gesture.current = null
  }, [targets])
  return <>
    <primitive object={pivot} />
    <TransformControls object={pivot} mode="translate" space="world"
      ref={control => { if (control) control.userData.isPathGizmo = true }}
      onMouseDown={() => {
        onStart()
        gesture.current = { move: onBegin(targets), origin: pivot.position.clone() }
      }}
      onObjectChange={() => {
        const drag = gesture.current
        if (drag) translateGroup(drag.move, pivot.position.clone().sub(drag.origin))
      }}
      onMouseUp={() => {
        const drag = gesture.current
        gesture.current = null
        if (drag && !pivot.position.equals(drag.origin)) onCommit(drag.move)
      }} />
  </>
}
