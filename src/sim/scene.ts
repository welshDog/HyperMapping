import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Box } from './box';
import { toColumnMajor } from './math';
import { createProjectiveMaterial, setProjector } from './projective-material';
import { PROJECTOR_FAR, PROJECTOR_NEAR, projectorCamera, type Projector, type ProjectorCamera } from './solve';

const DEG = Math.PI / 180;

/** The three.js side of the simulator: floor, box, projector marker + frustum, orbit view. */
export class SimScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  private readonly controls: OrbitControls;
  private readonly material: THREE.ShaderMaterial;
  private readonly boxMesh: THREE.Mesh;
  private readonly boxEdges: THREE.LineSegments;
  private readonly marker: THREE.Mesh;
  private readonly frustum: THREE.LineSegments;
  private readonly observer: ResizeObserver;
  private raf = 0;
  private running = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly texture: THREE.Texture,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x111114);

    this.camera.position.set(4, 3, 5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.5, 0);
    this.controls.update();

    this.scene.add(new THREE.GridHelper(10, 20, 0x444450, 0x2a2a32));

    this.material = createProjectiveMaterial(texture);
    this.boxMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.boxEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.boxMesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x555566 }),
    );
    this.marker = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.25), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
    this.frustum = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.5 }),
    );
    this.scene.add(this.boxMesh, this.boxEdges, this.marker, this.frustum);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Rebuild the box, move the projector marker and frustum, and update the projective matrices. */
  setLayout(box: Box, projector: Projector): void {
    this.boxMesh.geometry.dispose();
    this.boxMesh.geometry = new THREE.BoxGeometry(box.width, box.height, box.depth);
    this.boxEdges.geometry.dispose();
    this.boxEdges.geometry = new THREE.EdgesGeometry(this.boxMesh.geometry);
    for (const o of [this.boxMesh, this.boxEdges]) {
      o.position.set(0, box.height / 2, 0);
      o.rotation.y = box.yawDeg * DEG;
    }
    const cam = projectorCamera(projector, box);
    setProjector(this.material, cam);
    this.marker.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
    this.marker.lookAt(0, box.height / 2, 0);
    this.updateFrustum(cam, projector);
  }

  private updateFrustum(cam: ProjectorCamera, projector: Projector): void {
    const inv = new THREE.Matrix4().fromArray(toColumnMajor(cam.viewProj)).invert();
    const depth = Math.max(1, projector.distance * 1.2);
    const n = PROJECTOR_NEAR;
    const f = PROJECTOR_FAR;
    const zNdc = (f + n) / (f - n) - (2 * f * n) / ((f - n) * depth);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => new THREE.Vector3(x, y, zNdc).applyMatrix4(inv));
    const eye = new THREE.Vector3(cam.eye[0], cam.eye[1], cam.eye[2]);
    const pts: THREE.Vector3[] = [];
    corners.forEach((c, i) => {
      pts.push(eye, c, c, corners[(i + 1) % 4]);
    });
    this.frustum.geometry.dispose();
    this.frustum.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.texture.needsUpdate = true; // the projector image is a live canvas
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    this.boxMesh.geometry.dispose();
    this.boxEdges.geometry.dispose();
    (this.boxEdges.material as THREE.Material).dispose();
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.frustum.geometry.dispose();
    (this.frustum.material as THREE.Material).dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
