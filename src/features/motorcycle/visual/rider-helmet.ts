/** A fitted full-face helmet, attached to the real imported head joint rather than the bike frame. */
import { Bone, Box3, BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, SkinnedMesh, TubeGeometry, Vector3, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Helmet {
  readonly root: Group;
  readonly meshes: readonly Mesh[];
  readonly materials: readonly Material[];
}
type Ring = readonly [height: number, front: number, back: number, halfWidth: number];
const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

export function createRiderHelmet(head: Bone, human: readonly Mesh[], reference: Object3D): Helmet {
  reference.updateWorldMatrix(true, true);
  const headJoints = new Set<Object3D>();
  head.traverse((joint) => headJoints.add(joint));
  const headBounds = new Box3();
  const headPosition = reference.worldToLocal(head.getWorldPosition(V()));
  const point = V();
  // Select the real skin vertices driven by Head or its facial children. This excludes jacket and neck bulk.
  for (const entry of human) {
    if (!(entry as SkinnedMesh).isSkinnedMesh) continue;
    const skin = entry as SkinnedMesh;
    const indices = skin.geometry.getAttribute('skinIndex');
    const weights = skin.geometry.getAttribute('skinWeight');
    const positions = skin.geometry.getAttribute('position');
    if (!indices || !weights) continue;
    const hair = (Array.isArray(skin.material) ? skin.material : [skin.material]).some((material) => /opacity|hair|lash/i.test(material.name));
    let headVertices = 0;
    for (let i = 0; i < positions.count; i++) {
      let headWeight = 0;
      for (let j = 0; j < 4; j++) {
        const joint = skin.skeleton.bones[indices.getComponent(i, j)];
        if (joint && headJoints.has(joint)) headWeight += weights.getComponent(i, j);
      }
      if (headWeight < 0.5) continue;
      headVertices++;
      if (hair) continue;
      skin.getVertexPosition(i, point);
      skin.localToWorld(point);
      reference.worldToLocal(point);
      if (point.y >= headPosition.y - 0.012) headBounds.expandByPoint(point);
    }
    // Rocketbox's separate opacity surface contains hair cards, eyebrows and lashes. The face skin remains.
    if (hair && headVertices > positions.count * 0.8) skin.visible = false;
  }
  if (headBounds.isEmpty()) throw new Error('rider: cannot fit helmet to the imported head skin');

  const centreX = (headBounds.min.x + headBounds.max.x) / 2;
  const centreZ = (headBounds.min.z + headBounds.max.z) / 2;
  const baseY = headPosition.y - 0.015;
  const topY = headBounds.max.y + 0.025;
  const height = topY - baseY;
  const front = headBounds.max.x - centreX + 0.031;
  const back = centreX - headBounds.min.x + 0.024;
  const halfWidth = (headBounds.max.z - headBounds.min.z) / 2 + 0.023;
  const eye = reference.getObjectByName('Bip01_LEye');
  const eyeY = eye ? reference.worldToLocal(eye.getWorldPosition(V())).y : baseY + height * 0.35;
  const visorBottom = Math.max(height * 0.18, eyeY - baseY - 0.052);
  const visorTop = Math.min(height * 0.63, eyeY - baseY + 0.043);
  const aperture = Math.PI * 10 / 24;
  const rings: readonly Ring[] = [
    [0, front * 0.76, back * 0.7, halfWidth * 0.60],
    [0.065, front * 1.12, back * 0.85, halfWidth * 0.81],
    [0.20, front * 1.15, back * 0.97, halfWidth * 0.98],
    [0.38, front * 1.05, back, halfWidth],
    [0.55, front, back, halfWidth],
    [0.72, front * 0.91, back * 0.94, halfWidth * 0.94],
    [0.86, front * 0.72, back * 0.76, halfWidth * 0.77],
    [0.965, front * 0.33, back * 0.36, halfWidth * 0.38],
    [1, 0, 0, 0],
  ];
  const section = (y: number): readonly [number, number, number] => {
    const t = Math.min(1, Math.max(0, y / height));
    let index = 0;
    while (index < rings.length - 2 && t > rings[index + 1]![0]) index++;
    const a = rings[index]!;
    const b = rings[index + 1]!;
    const u = (t - a[0]) / (b[0] - a[0]);
    const smooth = u * u * (3 - 2 * u);
    return [a[1] + (b[1] - a[1]) * smooth, a[2] + (b[2] - a[2]) * smooth, a[3] + (b[3] - a[3]) * smooth];
  };
  const surface = (angle: number, y: number, offset = 0): Vector3 => {
    const [f, b, width] = section(y);
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    return V(Math.sign(x) * Math.pow(Math.abs(x), 0.9) * (x >= 0 ? f : b) + x * offset, y, z * (width + offset));
  };
  const patch = (angles: readonly number[], levels: readonly number[], cutFace = false, offset = 0): BufferGeometry => {
    const vertices: number[] = [];
    const uv: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < levels.length; i++) {
      for (let j = 0; j < angles.length; j++) {
        const p = surface(angles[j]!, levels[i]!, offset);
        vertices.push(p.x, p.y, p.z);
        uv.push(j / (angles.length - 1), i / (levels.length - 1));
        if (i >= levels.length - 1 || j >= angles.length - 1) continue;
        const y = (levels[i]! + levels[i + 1]!) / 2;
        const angle = (angles[j]! + angles[j + 1]!) / 2;
        if (cutFace && y > visorBottom && y < visorTop && Math.abs(angle) < aperture) continue;
        const k = i * angles.length + j;
        indices.push(k, k + angles.length, k + 1, k + 1, k + angles.length, k + angles.length + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };
  const angles = Array.from({ length: 49 }, (_, i) => -Math.PI + Math.PI * 2 * i / 48);
  const cuts = [...new Set([...rings.map((ring) => ring[0] * height), visorBottom, visorTop])].sort((a, b) => a - b);
  const levels: number[] = [];
  for (let i = 0; i < cuts.length - 1; i++) levels.push(cuts[i]!, (cuts[i]! + cuts[i + 1]!) / 2);
  levels.push(height);

  const shellMaterial = new MeshPhysicalMaterial({ name: 'rider:helmet-shell', color: 0xe8e4d9, metalness: 0.04, roughness: 0.25, clearcoat: 0.95, clearcoatRoughness: 0.13, side: DoubleSide });
  const trimMaterial = new MeshStandardMaterial({ name: 'rider:helmet-trim', color: 0x171b1e, metalness: 0.12, roughness: 0.6 });
  const visorMaterial = new MeshPhysicalMaterial({ name: 'rider:helmet-visor', color: 0x91a1a8, roughness: 0.09, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.36, depthWrite: false, side: DoubleSide });
  const shell = new Mesh(patch(angles, levels, true), shellMaterial);
  shell.name = 'rider:helmet-shell';
  const visorAngles = Array.from({ length: 25 }, (_, i) => -aperture + aperture * 2 * i / 24);
  const visorLevels = Array.from({ length: 9 }, (_, i) => visorBottom + (visorTop - visorBottom) * i / 8);
  const visor = new Mesh(patch(visorAngles, visorLevels, false, 0.003), visorMaterial);
  visor.name = 'rider:helmet-visor';
  visor.renderOrder = 2;
  const trimParts: BufferGeometry[] = [];
  const edge: Vector3[] = [];
  for (let i = 0; i <= 10; i++) edge.push(surface(-aperture, visorBottom + (visorTop - visorBottom) * i / 10, 0.003));
  for (let i = 1; i <= 20; i++) edge.push(surface(-aperture + aperture * 2 * i / 20, visorTop, 0.003));
  for (let i = 1; i <= 10; i++) edge.push(surface(aperture, visorTop - (visorTop - visorBottom) * i / 10, 0.003));
  for (let i = 1; i < 20; i++) edge.push(surface(aperture - aperture * 2 * i / 20, visorBottom, 0.003));
  trimParts.push(new TubeGeometry(new CatmullRomCurve3(edge, true, 'centripetal'), 72, 0.0034, 5, true));
  const rim = angles.slice(0, -1).map((angle) => surface(angle, height * 0.012, 0.001));
  trimParts.push(new TubeGeometry(new CatmullRomCurve3(rim, true, 'centripetal'), 48, 0.004, 5, true));
  for (const side of [-1, 1]) {
    const hinge = surface(side * aperture, (visorBottom + visorTop) / 2, 0.004);
    trimParts.push(new CylinderGeometry(0.012, 0.012, 0.004, 16).rotateX(Math.PI / 2).translate(hinge.x - 0.008, hinge.y, hinge.z));
  }
  // Two slim forehead vents and three chin-bar vents, without logos or large decorative shapes.
  for (const side of [-1, 1]) {
    const p = surface(side * 0.25, height * 0.73, 0.003);
    trimParts.push(new BoxGeometry(0.004, 0.006, 0.023).rotateY(-side * 0.15).translate(p.x, p.y, p.z));
  }
  for (const z of [-0.021, 0, 0.021]) {
    const y = height * 0.12;
    const p = surface(Math.asin(z / halfWidth), y, 0.003);
    trimParts.push(new BoxGeometry(0.004, 0.006, 0.012).translate(p.x, p.y, p.z));
  }
  const trimGeometry = mergeGeometries(trimParts, false);
  for (const part of trimParts) part.dispose();
  if (!trimGeometry) throw new Error('rider: incompatible helmet edge geometry');
  const trim = new Mesh(trimGeometry, trimMaterial);
  trim.name = 'rider:helmet-trim';

  const helmet = new Group();
  helmet.name = 'rider:helmet';
  helmet.add(shell, trim, visor);
  for (const mesh of [shell, trim, visor]) {
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  }
  // Desired helmet dimensions are metres in bike/body space; the artist's Head joint uses centimetres and
  // non-anatomical axes. Inverting its actual matrix compensates both, while retaining a real bone attachment.
  const desiredWorld = new Matrix4().copy(reference.matrixWorld).multiply(new Matrix4().makeTranslation(centreX, baseY, centreZ));
  const attachment = new Matrix4().copy(head.matrixWorld).invert().multiply(desiredWorld);
  attachment.decompose(helmet.position, helmet.quaternion, helmet.scale);
  head.add(helmet);
  helmet.updateWorldMatrix(true, true);
  helmet.userData.headBounds = { min: headBounds.min.toArray(), max: headBounds.max.toArray() };
  helmet.userData.fittedDimensions = [front + back, height, halfWidth * 2];
  return { root: helmet, meshes: [shell, trim, visor], materials: [shellMaterial, trimMaterial, visorMaterial] };
}
