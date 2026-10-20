/** A drag remains a drag even if the pointer returns to its starting point. */
export class SelectionGesture {
  private start: { x: number; y: number; id: number } | null = null
  blocked = false
  begin(x: number, y: number, id: number) {
    this.start = { x, y, id }
    this.blocked = false
  }
  move(x: number, y: number, id: number) {
    if (this.start?.id === id && Math.hypot(x - this.start.x, y - this.start.y) > 4) this.blocked = true
  }
  consume() { this.blocked = true }
}

export function sameSelectionHit(pressed: { object: string; batchId?: number } | null, object: string, batchId?: number) {
  return pressed?.object === object && pressed.batchId === batchId
}
