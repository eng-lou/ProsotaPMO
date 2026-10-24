// Read only FBX GlobalSettings, without decoding geometry or embedded textures.
export function fbxSourceSettings(bytes: ArrayBuffer): {upAxis: 'y'|'z'; unitScale: number} {
  const view = new DataView(bytes), decoder = new TextDecoder()
  const values: Record<string, number> = {}
  if (decoder.decode(new Uint8Array(bytes, 0, Math.min(23, bytes.byteLength))).startsWith('Kaydara FBX Binary')) {
    const wide = view.getUint32(23, true) >= 7500
    const word = (p: number) => wide ? Number(view.getBigUint64(p, true)) : view.getUint32(p, true)
    const size = wide ? 8 : 4
    function nodes(start: number, limit: number, collect = false) {
      let p = start
      while (p + size * 3 + 1 <= limit) {
        const end = word(p), count = word(p + size), length = word(p + size * 2)
        if (!end) break
        if (end <= p || end > bytes.byteLength) throw Error('Invalid FBX node boundary')
        const n = view.getUint8(p + size * 3), nameAt = p + size * 3 + 1
        const name = decoder.decode(new Uint8Array(bytes, nameAt, n)), propsAt = nameAt + n
        if (name === 'GlobalSettings' || (collect && name === 'Properties70')) nodes(propsAt + length, end, true)
        if (collect && name === 'P') {
          let q = propsAt
          const props: (string|number)[] = []
          for (let i = 0; i < count; i++) {
            const type = String.fromCharCode(view.getUint8(q++))
            if (type === 'S') { const len=view.getUint32(q,true); q+=4; props.push(decoder.decode(new Uint8Array(bytes,q,len))); q+=len }
            else if (type === 'I') { props.push(view.getInt32(q,true)); q+=4 }
            else if (type === 'D') { props.push(view.getFloat64(q,true)); q+=8 }
            else break
          }
          if (typeof props[0] === 'string' && typeof props[4] === 'number') values[props[0]] = props[4]
        }
        p = end
      }
    }
    nodes(27, bytes.byteLength)
  } else {
    const text=decoder.decode(bytes), settings=text.match(/GlobalSettings\s*:[\s\S]*?Properties70\s*:\s*\{([\s\S]*?)\}/)?.[1] || ''
    for (const key of ['UpAxis','UpAxisSign','UnitScaleFactor']) {
      const match=settings.match(new RegExp('P:\\s*"'+key+'"[^\\n]*,\\s*([-+0-9.eE]+)\\s*(?:\\r?\\n|$)'))
      if(match)values[key]=Number(match[1])
    }
  }
  if (values.UpAxis !== 1 && values.UpAxis !== 2) throw Error('Cannot detect FBX up axis. Choose its source up axis explicitly.')
  if (values.UpAxisSign !== undefined && values.UpAxisSign !== 1) throw Error('This FBX uses a negative up axis. Re-export with positive Y or Z up.')
  const scale=values.UnitScaleFactor / 100
  if (!Number.isFinite(scale) || scale <= 0) throw Error('Cannot detect FBX units. Choose its source units explicitly.')
  return {upAxis: values.UpAxis === 2 ? 'z' : 'y', unitScale: scale}
}
