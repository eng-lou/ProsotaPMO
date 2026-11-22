import { AnimationClip, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { coreHardwareBuilder, type Finish } from './coreRigGeometry'

const pinHeight = -.39
const pinSpacing = 1.8
const lowerPinHeight = pinHeight - pinSpacing
const point = (x:number, y:number, z:number) => new Vector3(x,y,z)

function mount(parent:Object3D, name:string, x:number, y:number, z:number) {
  const node = new Group()
  node.name = name
  node.position.set(x,y,z)
  parent.add(node)
  return node
}

// The original eight rods and their shoes already carry the correct upper/lower motion.
// Use a moving shoe as the common reference for all lower brackets, including old imported rigs.
export function installCoreConnections(frame:Object3D, clips:AnimationClip[] = []) {
  if (frame.userData.coreRigVersion !== 1) return
  const hardware = frame.children.find(n => n.userData.coreRigPart === 'hardware')
  const oldRod = hardware?.children.find(n => n.userData.coreRigPart === 'ram')
  const oldShoe = hardware?.children.find(n => n.userData.coreRigPart === 'lower')
  if (!hardware || !oldRod || !oldShoe) return

  const materials = {} as Record<Finish,MeshStandardMaterial>
  hardware.traverse(node => {
    if (node instanceof Mesh && node.material instanceof MeshStandardMaterial && node.material.name.startsWith('Core rig ')) {
      materials[node.material.name.slice(9) as Finish] = node.material
    }
  })
  if (!materials.frame || !materials.steel || !materials.boom || !materials.hydraulic || !materials.grip) return
  const {box,member,finish} = coreHardwareBuilder(materials)
  const newRods:Object3D[] = []
  const lowerFrame = mount(oldShoe,'Core_Lower_Bracket_Frame',-oldShoe.position.x,-oldShoe.position.y,-oldShoe.position.z)

  // Author each elevation in the same coordinates: X along the wall, +Z out onto the gallery.
  for (const side of ['North','South','East','West'] as const) {
    const long = side === 'North' || side === 'South'
    const angle = {South:0, North:Math.PI, East:Math.PI/2, West:-Math.PI/2}[side]
    const origin = point(0,0,long?4:6).applyAxisAngle(point(0,1,0),angle)
    const fixed = mount(hardware,'Core_Upper_Brackets_'+side,origin.x,0,origin.z)
    const lower = mount(lowerFrame,'Core_Lower_Brackets_'+side,origin.x,0,origin.z)
    fixed.rotation.y = lower.rotation.y = angle
    lower.userData.coreSupportFace = side

    function slidingNode(name:string, x:number, y:number, z:number, role:'ram'|'ramHousing') {
      const node = mount(fixed,'Core_'+side+'_'+name,x,y,z)
      node.userData.coreRigPart = role
      if (role === 'ram') node.scale.y = pinSpacing
      newRods.push(node)
      return node
    }

    for (const x of long ? [-5,-2,2,5] : [-2,2]) {
      const z = .97
      // The red strongback carries the upper work deck and terminates in a double-shear head.
      box(fixed,'frame',x,1.78,1.11,.20,4.08,.22)
      box(fixed,'frame',x,3.73,.69,.25,.25,1.85)
      member(fixed,'frame',point(x,2.94,1.11),point(x,3.73,.20),.13)
      box(fixed,'frame',x,-.17,.86,.29,.22,1.66)
      box(fixed,'frame',x,-.87,.19,.27,1.62,.24)
      member(fixed,'frame',point(x,-1.59,.20),point(x,-.17,1.52),.16)
      box(fixed,'frame',x,-1.49,.055,.45,.40,.12)
      for (const dx of [-.16,.16]) {
        box(fixed,'frame',x+dx,-.30,z,.09,.33,.32)
        box(lower,'boom',x+dx,lowerPinHeight-.10,z,.085,.36,.32)
      }
      member(fixed,'steel',point(x-.245,pinHeight,z),point(x+.245,pinHeight,z),.15,true)
      member(lower,'steel',point(x-.245,lowerPinHeight,z),point(x+.245,lowerPinHeight,z),.15,true)

      // The base spans from the wall plate to the lower gallery beam. The piston eye sits above the deck.
      box(lower,'boom',x,-2.45,.79,.30,.22,1.60)
      box(lower,'boom',x,-2.68,.12,.29,.69,.22)
      member(lower,'boom',point(x,-2.99,.14),point(x,-2.46,1.26),.14)
      box(lower,'grip',x,-2.66,.045,.55,.70,.11)
      for (const dx of [-.19,.19]) {
        member(lower,'steel',point(x+dx,-2.56,-.025),point(x+dx,-2.56,.15),.115,true)
      }

      const barrel = slidingNode('Lift_Barrel_'+x,x,pinHeight,z,'ramHousing')
      const rod = slidingNode('Lift_Rod_'+x,x,pinHeight,z,'ram')
      rod.userData.coreLiftStation = side
      member(barrel,'grip',point(0,.04,0),point(0,-.19,0),.235,true)
      member(barrel,'hydraulic',point(0,-.12,0),point(0,-1.05,0),.30,true)
      for (const y of [-.19,-.96]) member(barrel,'grip',point(0,y,0),point(0,y-.085,0),.332,true)
      member(barrel,'steel',point(0,-1.03,0),point(0,-1.10,0),.258,true)
      // Overlap both rod stages inside the next larger member throughout the stroke.
      member(rod,'hydraulic',point(0,-.02,0),point(0,-.65,0),.214,true)
      member(rod,'grip',point(0,-.628,0),point(0,-.65,0),.232,true)
      member(rod,'steel',point(0,-.61,0),point(0,-1,0),.143,true)
    }

    // The original rail and suspension post at each bay both move with the lower galleries.
    // Inner sections reach down inside those original profiles even at maximum separation.
    const length = long ? 12 : 8
    const bays = Math.ceil(length/2.4)
    for (let i=0;i<bays;i++) {
      const x = (i+.5)*length/bays-length/2
      for (const [type,z,width] of [['Rail',.25,.105],['Hanger',1.62,.067]] as const) {
        const guide = slidingNode(type+'_'+i,x,-.6,z,'ram')
        member(guide,'steel',point(0,0,0),point(0,-1,0),width)
        box(fixed,'grip',x,-.36,z,width+.05,.57,width+.05)
        box(fixed,'frame',x,-.14,z,.26,.12,.28)
      }
    }
  }
  finish()

  // Earlier saved GLBs have baked scale/rotation tracks for the first rod. The extra
  // slides share that authored stroke; housing and pin diameters stay constant.
  for (const clip of clips) {
    const tracks = clip.tracks.filter(t => t.name === oldRod.name+'.scale' || t.name === oldRod.name+'.quaternion')
    for (const track of tracks) {
      const property = track.name.slice(oldRod.name.length)
      for (const node of newRods) {
        if (property === '.scale' && node.userData.coreRigPart === 'ramHousing') continue
        const copy = track.clone()
        copy.name = node.name+property
        clip.tracks.push(copy)
      }
    }
  }
  frame.userData.coreRigVersion = 2
}
