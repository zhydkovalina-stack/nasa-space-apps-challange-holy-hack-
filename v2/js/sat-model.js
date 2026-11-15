import * as THREE from "three";

// Small solid NISAR for the hero, built from the same geometry as the "Take NISAR apart" model
// (anatomy.js): bus, two 3-panel wings, octagonal radar tower, two-segment boom and the 12 m drum
// reflector. Shaded with the site's stepped palette gradient (plum → indigo → periwinkle → ice) plus
// grain, instead of realistic lighting, so it sits in the page like the other banded textures.

const RAMP = ["#2b1752", "#5a45c2", "#8f9cf2", "#d6defc"].map((h) => new THREE.Color(h));
const time = { value: 0 };

function bandMat({ alpha = 1, steps = 5, lift = 0, side = THREE.FrontSide, uv = false } = {}) {
  return new THREE.ShaderMaterial({
    transparent: alpha < 1, depthWrite: alpha >= 1, side,
    uniforms: { uRamp: { value: RAMP }, uAlpha: { value: alpha }, uSteps: { value: steps }, uLift: { value: lift }, uUv: { value: uv ? 1 : 0 }, uTime: time },
    vertexShader: `
      varying vec3 vPos;
      varying vec2 vUv;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vPos = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uRamp[4]; uniform float uAlpha, uSteps, uLift, uUv, uTime;
      varying vec2 vUv;
      varying vec3 vPos;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 ramp(float t) {
        t = clamp(t, 0.0, 1.0) * 3.0;
        if (t < 1.0) return mix(uRamp[0], uRamp[1], t);
        if (t < 2.0) return mix(uRamp[1], uRamp[2], t - 1.0);
        return mix(uRamp[2], uRamp[3], t - 2.0);
      }
      void main() {
        vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));          // flat facet normal (view space)
        if (!gl_FrontFacing) n = -n;
        vec3 l = normalize(vec3(-0.45, 0.65, 0.6));                 // soft light from the upper left
        float d = dot(n, l) * 0.5 + 0.5;
        float rim = pow(1.0 - abs(dot(n, normalize(-vPos))), 2.0);   // brighter edges, so it reads against the dark
        float t = uUv > 0.5 ? 0.12 + vUv.y * 0.7 + uLift          // reflector: radial gradient, centre dark → rim light
                            : (d - 0.5) * 1.25 + 0.5 + rim * 0.3 + uLift;   // solids: light + bright edges
        t = floor(t * uSteps) / (uSteps - 1.0);                       // stepped bands, not a smooth shade
        vec3 c = ramp(t) + (hash(gl_FragCoord.xy + floor(uTime * 12.0)) - 0.5) * 0.11;   // grain
        gl_FragColor = vec4(c, uAlpha);
      }`,
  });
}

export function buildSat() {
  const solid = bandMat(), panel = bandMat({ steps: 4, lift: 0.05 }), membrane = bandMat({ alpha: 0.45, steps: 5, side: THREE.DoubleSide, uv: true });
  const model = new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const add = (geo, mat, pos) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.copy(pos); model.add(m); return m; };
  const beam = (a, b, s, mat = solid) => {   // square tube from a to b
    const d = b.clone().sub(a), m = add(new THREE.BoxGeometry(s, d.length(), s), mat, a.clone().lerp(b, 0.5));
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); return m;
  };

  // bus (2.0 × 2.4 × 1.9), with the downlink dish and thrusters underneath
  add(new THREE.BoxGeometry(2.0, 2.4, 1.9), solid);
  add(new THREE.CylinderGeometry(0.32, 0.12, 0.25, 12), solid, V(-0.4, -1.4, 0.3));

  // solar wings along ±x: drive, yoke, three 1.9 × 2.7 panels each, tilted toward the sun
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 8), solid, V(s * 1.15, 0, 0)).rotation.z = Math.PI / 2;
    beam(V(s * 1.2, 0, 0), V(s * 1.75, 0.75, 0), 0.06);
    beam(V(s * 1.2, 0, 0), V(s * 1.75, -0.75, 0), 0.06);
    for (let p = 0; p < 3; p++) {
      const m = add(new THREE.BoxGeometry(1.9, 2.7, 0.05), panel, V(s * (1.75 + p * 1.98 + 0.95), 0, 0));
      m.rotation.x = 0.55;
    }
  }

  // radar instrument structure: octagonal prism along −z (z −0.95 … −6.2), flat faces up and down
  const R = 1.15, Z0 = -0.95, Z1 = -6.2, TOP = R * Math.cos(Math.PI / 8);
  const ris = new THREE.CylinderGeometry(R, R, Z0 - Z1, 8);
  ris.rotateY(Math.PI / 8); ris.rotateX(Math.PI / 2);
  add(ris, solid, V(0, 0, (Z0 + Z1) / 2));
  for (const z of [-1.8, -2.95, -4.1, -5.25]) add(new THREE.BoxGeometry(0.14, 0.62, 0.92), solid, V(TOP + 0.07, -0.08, z));   // T/R modules

  // drum reflector: centre (0.2, 11, −2.8), radius 6, depth 1.1; concave side faces down at the feeds
  const C = V(0.2, 11, -2.8), DR = 6, DH = 1.1;
  for (const dy of [DH / 2, -DH / 2]) add(new THREE.TorusGeometry(DR, 0.09, 4, 64), solid, V(C.x, C.y + dy, C.z)).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(DR, DR, DH, 64, 1, true), membrane, C);                  // drum band
  const prof = []; for (let i = 0; i <= 10; i++) { const r = (i / 10) * DR; prof.push(new THREE.Vector2(r, -DH / 2 + 0.55 * (1 - (r / DR) ** 2))); }
  add(new THREE.LatheGeometry(prof, 48), membrane, C);                                     // mesh surface

  // boom: bus top → elbow → reflector rim
  const B0 = V(0.55, 1.2, 0.5), B1 = V(1.1, 5.7, 2.7);
  const tr = Math.atan2(B1.z - C.z, B1.x - C.x), B2 = V(C.x + Math.cos(tr) * DR, C.y - DH / 2, C.z + Math.sin(tr) * DR);
  beam(B0, B1, 0.22); beam(B1, B2, 0.22);
  add(new THREE.BoxGeometry(0.45, 0.45, 0.45), solid, B1);

  // centre the model on its bounding box, then turn it so that −y (the dish's look direction)
  // points at Earth (+z of the outer group) and the tower runs along the flight path (+y)
  const ctr = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  model.children.forEach((m) => m.position.sub(ctr));
  model.rotation.x = -Math.PI / 2;
  const g = new THREE.Group();
  g.add(model);
  g.scale.setScalar(0.0105);
  return g;
}

export const satTime = time;
