/** Small repeatable weave maps: clothing catches light as fabric instead of smooth plastic. */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, RGBAFormat, Vector2 } from 'three';

function fabricMaps(): { normal: DataTexture; roughness: DataTexture } {
  const size = 128;
  const height = new Float32Array(size * size);
  const noise = (x: number, y: number) => {
    const n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
    return ((Math.imul(n ^ (n >>> 13), 1274126177) >>> 0) / 0xffffffff) - 0.5;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warp = Math.cos(x * Math.PI / 2);
      const weft = Math.cos(y * Math.PI / 2);
      const over = ((Math.floor(x / 4) + Math.floor(y / 4)) & 1) === 0;
      height[y * size + x] = (over ? warp * 0.7 + weft * 0.3 : warp * 0.3 + weft * 0.7) * 0.12 + noise(x, y) * 0.035;
    }
  }
  const normalPixels = new Uint8Array(size * size * 4);
  const roughnessPixels = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * 0.65;
      const dy = (at(x, y - 1) - at(x, y + 1)) * 0.65;
      const length = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normalPixels[i] = Math.round((dx / length * 0.5 + 0.5) * 255);
      normalPixels[i + 1] = Math.round((dy / length * 0.5 + 0.5) * 255);
      normalPixels[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      normalPixels[i + 3] = 255;
      const roughness = Math.round(215 + noise(x, y) * 25);
      roughnessPixels.set([roughness, roughness, roughness, 255], i);
    }
  }
  const texture = (pixels: Uint8Array) => {
    const map = new DataTexture(pixels, size, size, RGBAFormat);
    map.wrapS = map.wrapT = RepeatWrapping;
    map.repeat.set(6, 6);
    map.magFilter = LinearFilter;
    map.minFilter = LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 4;
    map.needsUpdate = true;
    return map;
  };
  return { normal: texture(normalPixels), roughness: texture(roughnessPixels) };
}

export function createRiderMaterials() {
  const maps = fabricMaps();
  const clothing = new MeshStandardMaterial({
    name: 'rider:clothing', vertexColors: true, color: 0xffffff,
    metalness: 0, roughness: 0.88, normalMap: maps.normal,
    normalScale: new Vector2(0.4, 0.4), roughnessMap: maps.roughness,
  });
  const helmet = new MeshPhysicalMaterial({
    name: 'rider:helmet', vertexColors: true, color: 0xffffff,
    metalness: 0, roughness: 0.27, clearcoat: 0.9, clearcoatRoughness: 0.16,
  });
  const visor = new MeshPhysicalMaterial({
    name: 'rider:visor', vertexColors: true, color: 0xffffff,
    metalness: 0.18, roughness: 0.11, clearcoat: 1, clearcoatRoughness: 0.06,
    envMapIntensity: 1.15,
  });
  return {
    clothing, helmet, visor,
    dispose() {
      clothing.dispose();
      helmet.dispose();
      visor.dispose();
      maps.normal.dispose();
      maps.roughness.dispose();
    },
  };
}
