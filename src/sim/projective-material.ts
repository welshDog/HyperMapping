import * as THREE from 'three';
import { toColumnMajor } from './math';
import type { ProjectorCamera } from './solve';

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Projective texturing: the same view-projection matrix the solver uses decides where each
// surface point lands in the projector image. NDC +Y is the top of the image; the CanvasTexture
// has flipY = true, so v = ndc.y * 0.5 + 0.5 samples the right row.
const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform mat4 uProjViewProj;
uniform vec3 uEye;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 clip = uProjViewProj * vec4(vWorld, 1.0);
  bool facing = dot(vNormalW, uEye - vWorld) > 0.0;
  if (clip.w <= 0.0 || !facing) { gl_FragColor = vec4(0.08, 0.08, 0.10, 1.0); return; }
  vec2 ndc = clip.xy / clip.w;
  if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) { gl_FragColor = vec4(0.08, 0.08, 0.10, 1.0); return; }
  gl_FragColor = texture2D(uTex, ndc * 0.5 + 0.5);
}`;

export function createProjectiveMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTex: { value: texture },
      uProjViewProj: { value: new THREE.Matrix4() },
      uEye: { value: new THREE.Vector3() },
    },
  });
}

export function setProjector(material: THREE.ShaderMaterial, cam: ProjectorCamera): void {
  (material.uniforms.uProjViewProj.value as THREE.Matrix4).fromArray(toColumnMajor(cam.viewProj));
  (material.uniforms.uEye.value as THREE.Vector3).set(cam.eye[0], cam.eye[1], cam.eye[2]);
}
