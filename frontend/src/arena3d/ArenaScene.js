/**
 * Monad Colosseum – AAA-Grade 3D Arena Scene
 *
 * Real Roman Colosseum architecture, GLB model loading (Khronos samples),
 * post-processing (Bloom + Vignette + FXAA), OrbitControls with auto-rotate,
 * GSAP combat animations, volumetric atmosphere, particle systems.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import gsap from 'gsap';

// ─── Constants ───────────────────────────────────────────────────────────────
const AGENT_COLORS = [
  0x8b5cf6, 0x06b6d4, 0xef4444, 0x22c55e,
  0xeab308, 0xf97316, 0xec4899, 0x3b82f6,
];
const AGENT_NAMES = ['VOID', 'FLUX', 'BLAZE', 'VENOM', 'STORM', 'NEON', 'FANG', 'APEX'];

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.0 },
    darkness: { value: 1.2 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `uniform float offset;uniform float darkness;uniform sampler2D tDiffuse;varying vec2 vUv;void main(){vec4 texel=texture2D(tDiffuse,vUv);vec2 uv=(vUv-vec2(0.5))*vec2(offset);gl_FragColor=vec4(mix(texel.rgb,vec3(1.0-darkness),dot(uv,uv)),texel.a);}`,
};

const ARENA_RADIUS = 42;
const TIER_COUNT = 5;
const ARCH_COLS = 48;

export class ArenaScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.agentMeshes = new Map();
    this.effects = [];
    this.torches = [];
    this.clock = new THREE.Clock();
    this.shakeIntensity = 0;
    this.loadedModels = {};

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initControls();
    this._initLights();
    this._buildColosseum();
    this._buildFloor();
    this._buildCenterPrize();
    this._buildTorches();
    this._createEnvironment();
    this._initPostProcessing();
    this._loadModels();
    this._animate();

    window.addEventListener('resize', () => this._onResize());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDERER / SCENE / CAMERA / CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.FogExp2(0xc8dce8, 0.002);
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(
      45, window.innerWidth / window.innerHeight, 0.1, 1000,
    );
    this.camera.position.set(0, 55, 95);
    this.camera.lookAt(0, 2, 0);
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 2, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 180;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.minPolarAngle = 0.2;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.enablePan = false;

    this.canvas.addEventListener('pointerdown', () => {
      this.controls.autoRotate = false;
      clearTimeout(this._autoRotateTimeout);
      this._autoRotateTimeout = setTimeout(() => {
        this.controls.autoRotate = true;
      }, 8000);
    });
  }

  _initPostProcessing() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y), 0.25, 0.4, 0.9,
    );
    this.composer.addPass(this.bloomPass);

    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset.value = 1.0;
    vignettePass.uniforms.darkness.value = 0.8;
    this.composer.addPass(vignettePass);

    this.fxaaPass = new ShaderPass(FXAAShader);
    const pr = this.renderer.getPixelRatio();
    this.fxaaPass.material.uniforms.resolution.value.set(
      1 / (size.x * pr), 1 / (size.y * pr),
    );
    this.composer.addPass(this.fxaaPass);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIGHTING
  // ═══════════════════════════════════════════════════════════════════════════

  _initLights() {
    // Bright ambient – daylight
    this.scene.add(new THREE.AmbientLight(0xfff5e6, 0.6));

    // Sun – warm directional
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.8);
    sun.position.set(-20, 50, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.far = 100;
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    // Sky hemisphere – blue sky + warm ground bounce
    this.scene.add(new THREE.HemisphereLight(0x87ceeb, 0xc2956b, 0.7));

    // Center crystal glow (kept for fantasy element)
    this.centerLight = new THREE.PointLight(0x8b5cf6, 5, 50, 1.5);
    this.centerLight.position.set(0, 6, 0);
    this.centerLight.castShadow = true;
    this.scene.add(this.centerLight);

    // Warm fill from opposite side
    const warmFill = new THREE.DirectionalLight(0xffcc88, 0.5);
    warmFill.position.set(15, 20, -20);
    this.scene.add(warmFill);

    // Ground bounce – warm sand reflection
    const bounce = new THREE.PointLight(0xddbb88, 0.4, 40, 2);
    bounce.position.set(0, -1, 0);
    this.scene.add(bounce);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODEL LOADING (GLB from Khronos Sample Assets)
  // ═══════════════════════════════════════════════════════════════════════════

  _loadModels() {
    this.gltfLoader = new GLTFLoader();

    this.gltfLoader.load('/models/Lantern.glb', (gltf) => {
      this.loadedModels.lantern = gltf.scene;
      this._placeLanterns();
    }, undefined, () => {});

    this.gltfLoader.load('/models/DamagedHelmet.glb', (gltf) => {
      this.loadedModels.helmet = gltf.scene;
      this._placeHelmetTrophies();
    }, undefined, () => {});

    this.gltfLoader.load('/models/ScatteringSkull.glb', (gltf) => {
      this.loadedModels.skull = gltf.scene;
      this._placeSkullDecorations();
    }, undefined, () => {});
  }

  _placeLanterns() {
    const base = this.loadedModels.lantern;
    if (!base) return;
    const lanternCount = Math.max(12, Math.round(ARENA_RADIUS * 0.5));
    for (let i = 0; i < lanternCount; i++) {
      const angle = (Math.PI * 2 / lanternCount) * i;
      const r = ARENA_RADIUS + 1.5;
      const lantern = base.clone();
      lantern.scale.setScalar(0.04);
      lantern.position.set(r * Math.cos(angle), 6.5, r * Math.sin(angle));
      lantern.rotation.y = -angle + Math.PI;
      lantern.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      this.scene.add(lantern);
    }
  }

  _placeHelmetTrophies() {
    const base = this.loadedModels.helmet;
    if (!base) return;
    const helmetCount = Math.max(10, Math.round(ARENA_RADIUS * 0.35));
    for (let i = 0; i < helmetCount; i++) {
      const angle = (Math.PI * 2 / helmetCount) * i;
      const r = ARENA_RADIUS + 0.3;
      const helmet = base.clone();
      helmet.scale.setScalar(0.8);
      helmet.position.set(r * Math.cos(angle), 7.8, r * Math.sin(angle));
      helmet.rotation.y = -angle;
      helmet.traverse((c) => { if (c.isMesh) c.castShadow = true; });
      this.scene.add(helmet);
    }
  }

  _placeSkullDecorations() {
    const base = this.loadedModels.skull;
    if (!base) return;
    const skullCount = Math.max(16, Math.round(ARENA_RADIUS * 0.7));
    for (let i = 0; i < skullCount; i++) {
      const angle = (Math.PI * 2 / skullCount) * i;
      const r = ARENA_RADIUS - 0.5;
      const skull = base.clone();
      skull.scale.setScalar(0.015);
      skull.position.set(r * Math.cos(angle), 2.2, r * Math.sin(angle));
      skull.rotation.y = -angle + Math.PI;
      skull.traverse((c) => { if (c.isMesh) c.castShadow = true; });
      this.scene.add(skull);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROMAN COLOSSEUM CONSTRUCTION
  // ═══════════════════════════════════════════════════════════════════════════

  _buildColosseum() {
    // Real travertine / sandstone palette
    const stoneMat = new THREE.MeshPhysicalMaterial({
      color: 0xd4c4a0, roughness: 0.8, metalness: 0.02, clearcoat: 0.05,
    });
    const darkStoneMat = new THREE.MeshPhysicalMaterial({
      color: 0xbaa882, roughness: 0.85, metalness: 0.02,
    });
    const trimMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0d0b0, roughness: 0.55, metalness: 0.08, clearcoat: 0.15,
    });

    this._buildArenaWall(stoneMat, darkStoneMat, trimMat);
    this._buildSeatingTiers(stoneMat, darkStoneMat);
    this._buildArchedGalleries(stoneMat, trimMat);
    this._buildColumns(stoneMat, trimMat);
    this._buildCornice(trimMat);
    this._buildRuins(stoneMat);
    this._buildGates(darkStoneMat, trimMat);
  }

  _buildArenaWall(stoneMat, darkStoneMat, trimMat) {
    const R = ARENA_RADIUS;
    const h = 3.5;

    const wallGeo = new THREE.CylinderGeometry(R, R, h, 64, 1, true);
    const wall = new THREE.Mesh(wallGeo, darkStoneMat);
    wall.position.y = h / 2;
    wall.receiveShadow = true;
    wall.castShadow = true;
    this.scene.add(wall);

    const ledgeGeo = new THREE.TorusGeometry(R + 0.3, 0.3, 8, 64);
    ledgeGeo.rotateX(Math.PI / 2);
    const ledge = new THREE.Mesh(ledgeGeo, trimMat);
    ledge.position.y = h;
    ledge.castShadow = true;
    this.scene.add(ledge);

    const btGeo = new THREE.TorusGeometry(R + 0.15, 0.2, 8, 64);
    btGeo.rotateX(Math.PI / 2);
    const bt = new THREE.Mesh(btGeo, trimMat);
    bt.position.y = 0.2;
    this.scene.add(bt);
  }

  _buildSeatingTiers(stoneMat, darkStoneMat) {
    const baseR = ARENA_RADIUS + 0.5;
    for (let tier = 0; tier < TIER_COUNT; tier++) {
      const innerR = baseR + tier * 3;
      const outerR = innerR + 2.8;
      const height = 2.0 + tier * 2.5;
      const depth = 2.0;
      const mat = tier % 2 === 0 ? stoneMat : darkStoneMat;

      const tierGeo = new THREE.CylinderGeometry(outerR, innerR, depth, 64, 1, true);
      const tierMesh = new THREE.Mesh(tierGeo, mat);
      tierMesh.position.y = height - depth / 2 + 3;
      tierMesh.receiveShadow = true;
      this.scene.add(tierMesh);

      const stepGeo = new THREE.TorusGeometry((innerR + outerR) / 2, 0.15, 4, 64);
      stepGeo.rotateX(Math.PI / 2);
      const step = new THREE.Mesh(stepGeo, stoneMat);
      step.position.y = height + 3.05;
      this.scene.add(step);

      const seatCount = Math.floor(24 + tier * 4);
      for (let s = 0; s < seatCount; s++) {
        const angle = (Math.PI * 2 / seatCount) * s;
        const sR = (innerR + outerR) / 2;
        const seatGeo = new THREE.BoxGeometry(0.7, 0.4, 0.6);
        const seat = new THREE.Mesh(seatGeo, darkStoneMat);
        seat.position.set(sR * Math.cos(angle), height + 3.2, sR * Math.sin(angle));
        seat.rotation.y = -angle;
        seat.receiveShadow = true;
        this.scene.add(seat);
      }
    }
  }

  _buildArchedGalleries(stoneMat, trimMat) {
    for (let level = 0; level < 3; level++) {
      const baseY = 4 + level * 3.5;
      const R = ARENA_RADIUS + 2 + level * 3;
      const pillarW = 0.35;
      const archH = 2.5;

      for (let i = 0; i < ARCH_COLS; i++) {
        const angle = (Math.PI * 2 / ARCH_COLS) * i;
        const nextAngle = (Math.PI * 2 / ARCH_COLS) * (i + 1);
        const midAngle = (angle + nextAngle) / 2;

        // Arch
        const archGeo = new THREE.TorusGeometry(0.6, 0.12, 6, 12, Math.PI);
        const arch = new THREE.Mesh(archGeo, trimMat);
        arch.position.set(R * Math.cos(midAngle), baseY + archH * 0.65, R * Math.sin(midAngle));
        arch.rotation.y = -midAngle + Math.PI / 2;
        arch.rotation.z = Math.PI;
        this.scene.add(arch);

        // Pillars
        const pGeo = new THREE.CylinderGeometry(pillarW * 0.5, pillarW * 0.6, archH * 0.7, 8);
        for (const aOff of [angle + 0.06, nextAngle - 0.06]) {
          const p = new THREE.Mesh(pGeo, stoneMat);
          p.position.set(R * Math.cos(aOff), baseY + archH * 0.3, R * Math.sin(aOff));
          p.castShadow = true;
          this.scene.add(p);
        }
      }

      // Floor ring
      const fGeo = new THREE.RingGeometry(R - 1.5, R + 1.5, 64);
      fGeo.rotateX(-Math.PI / 2);
      const f = new THREE.Mesh(fGeo, stoneMat);
      f.position.y = baseY;
      f.receiveShadow = true;
      this.scene.add(f);
    }
  }

  _buildColumns(stoneMat, trimMat) {
    const count = 24;
    const R = ARENA_RADIUS + 1;
    const colH = 14;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i;
      const x = R * Math.cos(angle);
      const z = R * Math.sin(angle);
      const g = new THREE.Group();
      g.position.set(x, 0, z);

      // Base
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.2), trimMat);
      base.position.y = 0.3;
      base.castShadow = true;
      g.add(base);

      // Shaft
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, colH, 12), stoneMat);
      shaft.position.y = colH / 2 + 0.6;
      shaft.castShadow = true;
      g.add(shaft);

      // Fluting
      for (let f = 0; f < 8; f++) {
        const fa = (Math.PI * 2 / 8) * f;
        const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, colH - 0.5, 4), stoneMat);
        fl.position.set(0.32 * Math.cos(fa), colH / 2 + 0.6, 0.32 * Math.sin(fa));
        g.add(fl);
      }

      // Capital
      const cap1 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.4, 8), trimMat);
      cap1.position.set(0, colH + 0.8, 0);
      g.add(cap1);
      const cap2 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 0.2, 8), trimMat);
      cap2.position.set(0, colH + 1.1, 0);
      g.add(cap2);

      // Abacus
      const ab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.15, 1.0), trimMat);
      ab.position.y = colH + 1.3;
      g.add(ab);

      this.scene.add(g);
    }
  }

  _buildCornice(trimMat) {
    const R = ARENA_RADIUS + 2 + (TIER_COUNT - 1) * 3 + 2;
    const corniceGeo = new THREE.TorusGeometry(R, 0.5, 6, 64);
    corniceGeo.rotateX(Math.PI / 2);
    const cornice = new THREE.Mesh(corniceGeo, trimMat);
    cornice.position.y = 4 + 3 * 3.5 + 1;
    cornice.castShadow = true;
    this.scene.add(cornice);

    const cCount = 48;
    for (let i = 0; i < cCount; i++) {
      const angle = (Math.PI * 2 / cCount) * i;
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), trimMat);
      c.position.set(R * Math.cos(angle), 4 + 3 * 3.5 + 1.8, R * Math.sin(angle));
      c.rotation.y = -angle;
      this.scene.add(c);
    }
  }

  _buildRuins(stoneMat) {
    const ruinAngles = [0.5, 1.3, 2.1, 2.9, 3.7, 4.5, 5.3];
    const R = ARENA_RADIUS + 8;
    for (const a of ruinAngles) {
      const g = new THREE.Group();
      g.position.set(R * Math.cos(a), 0, R * Math.sin(a));
      g.rotation.y = -a;

      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 8, 8), stoneMat);
      col.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
      col.position.y = 0.5;
      col.castShadow = true;
      g.add(col);

      for (let b = 0; b < 4; b++) {
        const sz = 0.4 + Math.random() * 0.8;
        const block = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.6, sz), stoneMat);
        block.position.set((Math.random() - 0.5) * 3, sz * 0.3, (Math.random() - 0.5) * 2);
        block.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.2);
        block.castShadow = true;
        block.receiveShadow = true;
        g.add(block);
      }
      this.scene.add(g);
    }
  }

  _buildGates(darkStoneMat, trimMat) {
    for (const a of [0, Math.PI]) {
      const R = ARENA_RADIUS;
      const g = new THREE.Group();
      g.position.set(R * Math.cos(a), 0, R * Math.sin(a));
      g.rotation.y = -a;

      const fw = 2.5, fh = 3.5;

      // Posts
      const postGeo = new THREE.BoxGeometry(0.5, fh, 0.8);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, trimMat);
        post.position.set(side * fw / 2, fh / 2, 0);
        post.castShadow = true;
        g.add(post);
      }

      // Lintel
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(fw + 1, 0.5, 0.9), trimMat);
      lintel.position.y = fh + 0.25;
      lintel.castShadow = true;
      g.add(lintel);

      // Arch
      const arch = new THREE.Mesh(new THREE.TorusGeometry(fw / 2, 0.2, 8, 16, Math.PI), trimMat);
      arch.position.y = fh;
      arch.rotation.z = Math.PI;
      g.add(arch);

      // Bars
      const barMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.4 });
      for (let b = -3; b <= 3; b++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, fh - 0.5, 4), barMat);
        bar.position.set(b * 0.3, fh / 2, 0);
        g.add(bar);
      }

      // Fire bowls at gates
      for (const side of [-1, 1]) {
        const bowl = new THREE.Mesh(
          new THREE.SphereGeometry(0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.5 }),
        );
        bowl.position.set(side * (fw / 2 + 0.8), fh + 0.5, 0);
        g.add(bowl);

        const fire = new THREE.PointLight(0xff6622, 2.5, 10, 1.5);
        fire.position.set(side * (fw / 2 + 0.8), fh + 1.0, 0);
        g.add(fire);

        const core = new THREE.Mesh(
          new THREE.SphereGeometry(0.2, 6, 6),
          new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff6622, emissiveIntensity: 3.0 }),
        );
        core.position.copy(fire.position);
        g.add(core);

        this.torches.push({ light: fire, core, particles: this._createFireParticles(g, fire.position), sprites: [] });
      }

      this.scene.add(g);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARENA FLOOR
  // ═══════════════════════════════════════════════════════════════════════════

  _buildFloor() {
    const R = ARENA_RADIUS;

    // Sandy arena floor – warm golden sand
    const floorGeo = new THREE.CircleGeometry(R, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshPhysicalMaterial({
      color: 0xd4b87a, roughness: 0.92, metalness: 0.0, clearcoat: 0.02,
    }));
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Inner ring – slightly darker sand
    const inner = new THREE.Mesh(
      (() => { const g = new THREE.CircleGeometry(R * 0.65, 48); g.rotateX(-Math.PI / 2); return g; })(),
      new THREE.MeshPhysicalMaterial({ color: 0xc4a868, roughness: 0.9, metalness: 0.0, clearcoat: 0.05 }),
    );
    inner.position.y = 0.01;
    inner.receiveShadow = true;
    this.scene.add(inner);

    // Glowing rune rings
    for (let ring = 0; ring < 3; ring++) {
      const r = [R - 0.5, R * 0.6, R * 0.35][ring];
      const intensity = [0.3, 0.6, 1.0][ring];
      const color = [0x3311aa, 0x8b5cf6, 0xbb77ff][ring];
      const rGeo = new THREE.TorusGeometry(r, 0.05, 4, 64);
      rGeo.rotateX(Math.PI / 2);
      const rMesh = new THREE.Mesh(rGeo, new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: intensity, metalness: 0.9, roughness: 0.1,
      }));
      rMesh.position.y = 0.04;
      this.scene.add(rMesh);
    }

    // Floor runes
    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI / 8) * i;
      const x = (R * 0.45) * Math.cos(angle), z = (R * 0.45) * Math.sin(angle);

      const runeGeo = new THREE.TorusGeometry(0.5, 0.03, 4, 16);
      runeGeo.rotateX(Math.PI / 2);
      const rune = new THREE.Mesh(runeGeo, new THREE.MeshStandardMaterial({
        color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 0.5,
      }));
      rune.position.set(x, 0.03, z);
      this.scene.add(rune);

      const sym = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.1, 0),
        new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 0.8, transparent: true, opacity: 0.6 }),
      );
      sym.position.set(x, 0.15, z);
      sym.rotation.y = angle;
      this.scene.add(sym);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CENTER PRIZE
  // ═══════════════════════════════════════════════════════════════════════════

  _buildCenterPrize() {
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 2.0, 2.5, 8),
      new THREE.MeshPhysicalMaterial({ color: 0x2a2a3a, metalness: 0.6, roughness: 0.4, clearcoat: 0.5 }),
    );
    pedestal.position.y = 1.25;
    pedestal.castShadow = true;
    this.scene.add(pedestal);

    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.4, 2),
      new THREE.MeshPhysicalMaterial({
        color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 2.5,
        metalness: 0.3, roughness: 0.0, transmission: 0.6, thickness: 1.5, ior: 2.0, clearcoat: 1.0,
      }),
    );
    this.crystal.position.y = 5.0;
    this.scene.add(this.crystal);

    this.innerCrystal = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.6, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbb88ff, emissiveIntensity: 3.0 }),
    );
    this.innerCrystal.position.y = 5.0;
    this.scene.add(this.innerCrystal);

    this.crystalRings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.6 + i * 0.4, 0.03, 4, 32),
        new THREE.MeshStandardMaterial({ color: 0xbb88ff, emissive: 0x8b5cf6, emissiveIntensity: 1.5, transparent: true, opacity: 0.4 }),
      );
      ring.position.y = 5.0;
      this.crystalRings.push(ring);
      this.scene.add(ring);
    }

    this.energyOrbs = [];
    for (let i = 0; i < 8; i++) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xddaaff, emissive: 0xbb88ff, emissiveIntensity: 3.0 }),
      );
      this.scene.add(orb);
      this.energyOrbs.push({ mesh: orb, phase: (Math.PI * 2 / 8) * i });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TORCHES
  // ═══════════════════════════════════════════════════════════════════════════

  _buildTorches() {
    const R = ARENA_RADIUS - 0.5;
    const torchCount = Math.max(16, Math.round(ARENA_RADIUS * 0.8));
    for (let i = 0; i < torchCount; i++) {
      const angle = (Math.PI * 2 / torchCount) * i;
      const g = new THREE.Group();
      g.position.set(R * Math.cos(angle), 0, R * Math.sin(angle));

      // Bracket + head
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.15), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.4 }));
      bracket.position.y = 2.8;
      g.add(bracket);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.7, roughness: 0.5 }));
      head.position.y = 3.1;
      g.add(head);

      const light = new THREE.PointLight(0xff6622, 2.5, 12, 1.5);
      light.position.y = 3.4;
      g.add(light);

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff6622, emissiveIntensity: 3.0 }),
      );
      core.position.y = 3.3;
      g.add(core);

      const sprites = [];
      for (let s = 0; s < 3; s++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          color: [0xff6622, 0xff9944, 0xffcc66][s],
          transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
        }));
        sp.scale.set(0.25 - s * 0.05, 0.35 - s * 0.08, 1);
        sp.position.y = 3.3 + s * 0.1;
        g.add(sp);
        sprites.push(sp);
      }

      const particles = this._createFireParticles(g, new THREE.Vector3(0, 3.25, 0));
      this.torches.push({ light, core, sprites, particles });
      this.scene.add(g);
    }
  }

  _createFireParticles(parent, pos) {
    const count = 12;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x + (Math.random() - 0.5) * 0.1;
      positions[i * 3 + 1] = pos.y + Math.random() * 0.3;
      positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xff8844, size: 0.06, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    parent.add(pts);
    return pts;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENVIRONMENT
  // ═══════════════════════════════════════════════════════════════════════════

  _createEnvironment() {
    this._createSky();
    this._createSun();
    this._createDust();
    this._createEmbers();
    this._createGroundFog();
  }

  _createSky() {
    // Gradient sky dome
    const skyGeo = new THREE.SphereGeometry(250, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x4a90d9) },
        bottomColor: { value: new THREE.Color(0xd4e5f7) },
        offset: { value: 20 },
        exponent: { value: 0.4 },
      },
      vertexShader: `varying vec3 vWorldPosition; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorldPosition = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main(){ float h = normalize(vWorldPosition + offset).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0), exponent), 0.0)), 1.0); }`,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Scattered clouds
    for (let i = 0; i < 15; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xffffff, transparent: true, opacity: 0.15 + Math.random() * 0.15,
      }));
      const a = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * 120;
      sp.position.set(d * Math.cos(a), 40 + Math.random() * 40, d * Math.sin(a));
      sp.scale.setScalar(30 + Math.random() * 50);
      this.scene.add(sp);
    }
  }

  _createSun() {
    // Sun sphere + glow
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(5, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffdd88, emissiveIntensity: 2.0 }),
    );
    sunMesh.position.set(-60, 80, 30);
    this.scene.add(sunMesh);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xffeecc, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending,
    }));
    glow.position.copy(sunMesh.position);
    glow.scale.set(40, 40, 1);
    this.scene.add(glow);
  }

  _createDust() {
    const count = 300;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = Math.random() * 15;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustParticles = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xccbb99, size: 0.08, transparent: true, opacity: 0.25, depthWrite: false,
    }));
    this.scene.add(this.dustParticles);
  }

  _createEmbers() {
    const count = 100;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 35;
      positions[i * 3 + 1] = Math.random() * 25;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 35;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.embers = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xff6622, size: 0.1, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(this.embers);
  }

  _createGroundFog() {
    // Warm sand dust haze on ground
    for (let i = 0; i < 60; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xddcc99, transparent: true, opacity: 0.04,
      }));
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * ARENA_RADIUS * 0.9;
      sp.position.set(r * Math.cos(a), 0.2 + Math.random() * 0.8, r * Math.sin(a));
      sp.scale.setScalar(5 + Math.random() * 8);
      this.scene.add(sp);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GLADIATOR WARRIOR
  // ═══════════════════════════════════════════════════════════════════════════

  _createWarrior(color, index) {
    const group = new THREE.Group();
    const mainMat = new THREE.MeshPhysicalMaterial({ color, metalness: 0.8, roughness: 0.15, emissive: color, emissiveIntensity: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1 });
    const darkMat = new THREE.MeshPhysicalMaterial({ color: 0x1a1a28, metalness: 0.6, roughness: 0.4, clearcoat: 0.3 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x3a2a2a, roughness: 0.9, metalness: 0 });
    const glowMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3.0 });

    // Legs + boots
    const legGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.8, 6);
    const bootGeo = new THREE.BoxGeometry(0.18, 0.15, 0.28);
    for (const xOff of [-0.18, 0.18]) {
      const leg = new THREE.Mesh(legGeo, darkMat); leg.position.set(xOff, 0.4, 0); leg.castShadow = true; group.add(leg);
      const boot = new THREE.Mesh(bootGeo, darkMat); boot.position.set(xOff, 0.07, 0.03); group.add(boot);
    }

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.7, 0.4), darkMat);
    torso.position.y = 1.15; torso.castShadow = true; group.add(torso);

    // Armor
    const armor = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.35, 0.42), mainMat);
    armor.position.y = 1.3; armor.castShadow = true; group.add(armor);

    // Shoulder pads
    for (const xOff of [-0.4, 0.4]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6, 0, Math.PI * 2, 0, Math.PI / 2), mainMat);
      pad.position.set(xOff, 1.55, 0); pad.castShadow = true; group.add(pad);
    }

    // Arms
    const armGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.55, 6);
    for (const xOff of [-0.38, 0.38]) {
      const arm = new THREE.Mesh(armGeo, skinMat); arm.position.set(xOff, 1.0, 0); arm.castShadow = true; group.add(arm);
    }

    // Head + helmet
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), skinMat);
    head.position.y = 1.78; head.castShadow = true; group.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8, 0, Math.PI * 2, 0, Math.PI / 1.5), mainMat);
    helmet.position.y = 1.82; group.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.15), mainMat);
    visor.position.set(0, 1.75, 0.15); group.add(visor);

    // Eyes
    for (const xOff of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 4, 4), glowMat);
      eye.position.set(xOff, 1.78, 0.17); group.add(eye);
    }

    // Weapon
    const weapon = new THREE.Group();
    weapon.position.set(0.5, 1.1, 0);
    const wStyle = index % 4;
    const _m = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
    if (wStyle === 0) {
      weapon.add(_m(new THREE.BoxGeometry(0.06, 1.0, 0.02), mainMat, 0, 0.5, 0));
      weapon.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6), darkMat));
      weapon.add(_m(new THREE.BoxGeometry(0.2, 0.04, 0.06), mainMat, 0, 0.08, 0));
    } else if (wStyle === 1) {
      weapon.add(_m(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), darkMat, 0, 0.3, 0));
      weapon.add(_m(new THREE.BoxGeometry(0.3, 0.25, 0.04), mainMat, 0.1, 0.7, 0));
    } else if (wStyle === 2) {
      weapon.add(_m(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6), darkMat, 0, 0.5, 0));
      weapon.add(_m(new THREE.ConeGeometry(0.06, 0.2, 6), mainMat, 0, 1.3, 0));
    } else {
      weapon.add(_m(new THREE.CylinderGeometry(0.03, 0.04, 0.8, 6), darkMat, 0, 0.2, 0));
      weapon.add(_m(new THREE.DodecahedronGeometry(0.15, 0), mainMat, 0, 0.7, 0));
    }
    group.add(weapon);

    // Shield
    const shield = new THREE.Group();
    shield.visible = false;
    const shieldDisc = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), mainMat);
    shieldDisc.position.set(-0.5, 1.2, 0.2);
    shield.add(shieldDisc);
    const barrier = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 16, 12),
      new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0, emissive: color, emissiveIntensity: 0.5, side: THREE.DoubleSide, transmission: 0.5 }),
    );
    barrier.position.y = 1.2;
    shield.add(barrier);
    shield.userData.barrier = barrier;
    group.add(shield);

    // Ground disc
    const discGeo = new THREE.RingGeometry(0.6, 0.7, 32);
    discGeo.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.4 }));
    disc.position.y = 0.02;
    group.add(disc);

    const circle = new THREE.Mesh(
      (() => { const g = new THREE.CircleGeometry(0.55, 32); g.rotateX(-Math.PI / 2); return g; })(),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.05 }),
    );
    circle.position.y = 0.01;
    group.add(circle);

    // HP bar
    const hpBar = this._createHPBar(color);
    hpBar.position.y = 2.5;
    group.add(hpBar);

    // Name
    const nameSprite = this._createNameSprite(AGENT_NAMES[index % AGENT_NAMES.length], color);
    nameSprite.position.y = 2.85;
    group.add(nameSprite);

    return { group, weapon, shield, armor, hpBar, disc, circle };
  }

  _createHPBar(color) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.1), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 })));
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.06), fillMat);
    fill.position.z = 0.001;
    g.add(fill);
    g.userData.fill = fill;
    g.userData.fillMat = fillMat;
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 }));
    frame.position.z = -0.001;
    g.add(frame);
    return g;
  }

  _createNameSprite(name, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 28px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
    ctx.fillText(name, 128, 40);
    const tex = new THREE.CanvasTexture(canvas);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9 }));
    sp.scale.set(1.5, 0.4, 1);
    return sp;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  setupAgents(agents) {
    for (const [, m] of this.agentMeshes) this.scene.remove(m.group);
    this.agentMeshes.clear();

    const count = agents.length;
    // Dynamic placement: single ring for ≤30, multi-ring for more
    const rings = [];
    if (count <= 30) {
      rings.push({ start: 0, end: count, radius: ARENA_RADIUS * 0.55 });
    } else if (count <= 60) {
      const half = Math.ceil(count / 2);
      rings.push({ start: 0, end: half, radius: ARENA_RADIUS * 0.45 });
      rings.push({ start: half, end: count, radius: ARENA_RADIUS * 0.7 });
    } else {
      const third = Math.ceil(count / 3);
      rings.push({ start: 0, end: third, radius: ARENA_RADIUS * 0.35 });
      rings.push({ start: third, end: third * 2, radius: ARENA_RADIUS * 0.55 });
      rings.push({ start: Math.min(third * 2, count), end: count, radius: ARENA_RADIUS * 0.75 });
    }

    agents.forEach((agent, i) => {
      let circleRadius = ARENA_RADIUS * 0.55;
      let ringOffset = i;
      let ringCount = count;
      for (const ring of rings) {
        if (i >= ring.start && i < ring.end) {
          circleRadius = ring.radius;
          ringOffset = i - ring.start;
          ringCount = ring.end - ring.start;
          break;
        }
      }
      const angle = ((Math.PI * 2) / ringCount) * ringOffset - Math.PI / 2;
      const x = circleRadius * Math.cos(angle);
      const z = circleRadius * Math.sin(angle);
      const color = AGENT_COLORS[i % AGENT_COLORS.length];

      const warrior = this._createWarrior(color, i);
      warrior.group.position.set(x, 0, z);
      warrior.group.lookAt(0, 0, 0);
      this.scene.add(warrior.group);
      this.agentMeshes.set(agent.id, { ...warrior, color, baseY: 0, index: i, alive: true });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TURN VISUALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  updateFromEvents(events, agents) {
    for (const [, m] of this.agentMeshes) {
      m.shield.visible = false;
      if (m.shield.userData.barrier) m.shield.userData.barrier.material.opacity = 0;
    }
    for (const evt of events) {
      switch (evt.type) {
        case 'defend': this._showShield(evt.agentId); break;
        case 'attack': this._showAttack(evt.attackerId, evt.defenderId, evt.damage); break;
        case 'betrayal': this._showBetrayal(evt.betrayer, evt.victim); break;
        case 'death': this._showDeath(evt.agentId); break;
        case 'alliance_formed': this._showAlliance(evt.alliance.members); break;
        case 'bribe': this._showBribe(evt.offerer || evt.attackerId, evt.target || evt.defenderId, evt.amount); break;
      }
    }
    if (agents) for (const a of agents) this._updateAgentState(a);
  }

  _showShield(agentId) {
    const m = this.agentMeshes.get(agentId);
    if (!m) return;
    m.shield.visible = true;
    const b = m.shield.userData.barrier;
    if (b) {
      gsap.fromTo(b.material, { opacity: 0 }, { opacity: 0.25, duration: 0.3, ease: 'power2.out' });
      gsap.fromTo(b.scale, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 1, z: 1, duration: 0.4, ease: 'back.out(1.5)' });
    }
    gsap.fromTo(m.shield.position, { y: 0.5 }, { y: 0, duration: 0.3, ease: 'power2.out' });
  }

  _showAttack(attackerId, defenderId, damage) {
    const aM = this.agentMeshes.get(attackerId);
    const dM = this.agentMeshes.get(defenderId);
    if (!aM || !dM) return;

    const aP = aM.group.position.clone();
    const dP = dM.group.position.clone();
    const dir = dP.clone().sub(aP).normalize();
    const lunge = aP.clone().add(dir.clone().multiplyScalar(2));

    const tl = gsap.timeline();
    tl.to(aM.group.position, { x: lunge.x, z: lunge.z, duration: 0.15, ease: 'power3.in' });
    tl.to(aM.group.position, { x: aP.x, z: aP.z, duration: 0.3, ease: 'power2.out' });

    if (aM.weapon) {
      gsap.to(aM.weapon.rotation, { z: -1.2, duration: 0.15, ease: 'power3.in', onComplete: () => gsap.to(aM.weapon.rotation, { z: 0, duration: 0.4, ease: 'elastic.out(1,0.5)' }) });
    }

    gsap.delayedCall(0.15, () => {
      gsap.to(dM.group.position, { x: dP.x - dir.x * 0.5, z: dP.z - dir.z * 0.5, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out' });
      if (dM.armor) {
        const oc = dM.armor.material.emissive.clone();
        dM.armor.material.emissive.set(0xff0000);
        dM.armor.material.emissiveIntensity = 2.0;
        gsap.to(dM.armor.material, { emissiveIntensity: 0.1, duration: 0.5, onComplete: () => dM.armor.material.emissive.copy(oc) });
      }
    });

    // Bolt
    const start = aP.clone().add(new THREE.Vector3(0, 1.5, 0));
    const end = dP.clone().add(new THREE.Vector3(0, 1.5, 0));
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, p = start.clone().lerp(end, t);
      if (i > 0 && i < 20) { p.x += (Math.random() - 0.5) * 0.5; p.y += (Math.random() - 0.5) * 0.5; p.z += (Math.random() - 0.5) * 0.5; }
      pts.push(p);
    }
    const bolt = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.08, 6, false),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff4444, emissiveIntensity: 4.0, transparent: true, opacity: 1 }),
    );
    this.scene.add(bolt);

    // Flash
    const fg = new THREE.Group(); fg.position.copy(end);
    const f1 = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff6644, emissiveIntensity: 5.0, transparent: true, opacity: 0.9 }));
    fg.add(f1);
    const f2 = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff4400, emissiveIntensity: 2.0, transparent: true, opacity: 0.4 }));
    fg.add(f2);

    // Sparks
    const sc = 15, sp = new Float32Array(sc * 3), sv = [];
    for (let i = 0; i < sc; i++) { sp[i * 3] = end.x; sp[i * 3 + 1] = end.y; sp[i * 3 + 2] = end.z; sv.push(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6)); }
    const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xffaa44, size: 0.12, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));

    this.scene.add(fg); this.scene.add(sparks);
    this.shakeIntensity = Math.min(0.6, (damage || 20) / 35);

    this.effects.push({
      mesh: bolt, extras: [fg, sparks], life: 0.6, decay: 2.0,
      update: (dt, eff) => {
        eff.life -= eff.decay * dt; const o = Math.max(0, eff.life);
        bolt.material.opacity = o; bolt.material.emissiveIntensity = o * 4;
        f1.material.opacity = o * 0.9; f2.material.opacity = o * 0.4;
        f1.scale.setScalar(1 + (1 - o) * 3); f2.scale.setScalar(1 + (1 - o) * 2);
        const pos = sparks.geometry.attributes.position;
        for (let i = 0; i < sc; i++) { sv[i].y -= 10 * dt; pos.setX(i, pos.getX(i) + sv[i].x * dt); pos.setY(i, pos.getY(i) + sv[i].y * dt); pos.setZ(i, pos.getZ(i) + sv[i].z * dt); }
        pos.needsUpdate = true; sparks.material.opacity = o;
      },
    });
  }

  _showBetrayal(betrayerId, victimId) {
    const bM = this.agentMeshes.get(betrayerId);
    const vM = this.agentMeshes.get(victimId);
    if (!bM || !vM) return;
    const start = bM.group.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const end = vM.group.position.clone().add(new THREE.Vector3(0, 1.5, 0));

    for (let fork = 0; fork < 3; fork++) {
      const points = [start.clone()];
      for (let i = 1; i < 10; i++) { const t = i / 10, p = start.clone().lerp(end, t); p.x += (Math.random() - 0.5) * (2 + fork); p.y += (Math.random() - 0.5) * 2 + 1; p.z += (Math.random() - 0.5) * (2 + fork); points.push(p); }
      points.push(end.clone());
      const color = fork === 0 ? 0xeab308 : 0xffdd44;
      const lightning = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 30, 0.04 + fork * 0.02, 4, false),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 5.0 - fork, transparent: true, opacity: 1 }),
      );
      this.scene.add(lightning);
      this.effects.push({ mesh: lightning, extras: [], life: 0.8 + fork * 0.2, decay: 2.0, update: (dt, eff) => { eff.life -= eff.decay * dt; const o = Math.max(0, eff.life); lightning.material.opacity = o; lightning.material.emissiveIntensity = o * 5; } });
    }
    gsap.to(vM.group.rotation, { z: 0.3, duration: 0.2, yoyo: true, repeat: 3, ease: 'power1.inOut', onComplete: () => { vM.group.rotation.z = 0; } });
    this.shakeIntensity = 0.8;
  }

  _showDeath(agentId) {
    const m = this.agentMeshes.get(agentId);
    if (!m) return;
    m.alive = false;

    const count = 60, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), vels = [];
    const bc = new THREE.Color(m.color);
    for (let i = 0; i < count; i++) { positions[i * 3] = 0; positions[i * 3 + 1] = 1; positions[i * 3 + 2] = 0; vels.push(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 7, (Math.random() - 0.5) * 6)); colors[i * 3] = bc.r; colors[i * 3 + 1] = bc.g; colors[i * 3 + 2] = bc.b; }
    const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ vertexColors: true, size: 0.2, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    particles.position.copy(m.group.position);
    this.scene.add(particles);

    const rGeo = new THREE.TorusGeometry(0.5, 0.15, 4, 32); rGeo.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(rGeo, new THREE.MeshStandardMaterial({ color: m.color, emissive: m.color, emissiveIntensity: 5.0, transparent: true, opacity: 1 }));
    ring.position.copy(m.group.position); ring.position.y = 1;
    this.scene.add(ring);

    gsap.to(m.group.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.8, ease: 'power2.in', delay: 0.2 });
    gsap.to(m.group.rotation, { x: -0.5, z: 0.3, duration: 0.6, ease: 'power2.in', delay: 0.1 });
    gsap.to(m.group.position, { y: -0.5, duration: 0.8, ease: 'power2.in', delay: 0.2 });
    this.shakeIntensity = 0.5;

    this.effects.push({
      mesh: particles, extras: [ring], life: 2.5, decay: 0.8,
      update: (dt, eff) => {
        eff.life -= eff.decay * dt; particles.material.opacity = Math.max(0, eff.life * 0.4);
        const pos = particles.geometry.attributes.position;
        for (let i = 0; i < count; i++) { vels[i].y -= 6 * dt; pos.setX(i, pos.getX(i) + vels[i].x * dt); pos.setY(i, pos.getY(i) + vels[i].y * dt); pos.setZ(i, pos.getZ(i) + vels[i].z * dt); }
        pos.needsUpdate = true;
        ring.scale.setScalar(1 + (2.5 - eff.life) * 3); ring.material.opacity = Math.max(0, eff.life * 0.4); ring.material.emissiveIntensity = eff.life * 5;
      },
    });
  }

  _showBribe(offererId, targetId, amount) {
    const oM = this.agentMeshes.get(offererId);
    const tM = this.agentMeshes.get(targetId);
    if (!oM || !tM) return;

    const p0 = oM.group.position.clone().add(new THREE.Vector3(0, 2.2, 0));
    const p1 = tM.group.position.clone().add(new THREE.Vector3(0, 2.2, 0));
    const mid = p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, 2.5, 0));
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);

    // Gold arc trail
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 30, 0.04, 6, false),
      new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 4.0, transparent: true, opacity: 0.6 }),
    );
    this.scene.add(tube);

    // Gold coin particles along the curve
    const coinCount = 16;
    const coinPos = new Float32Array(coinCount * 3);
    for (let i = 0; i < coinCount; i++) {
      const p = curve.getPoint(i / coinCount);
      coinPos[i * 3] = p.x + (Math.random() - 0.5) * 0.3;
      coinPos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.3;
      coinPos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.3;
    }
    const coinGeo = new THREE.BufferGeometry();
    coinGeo.setAttribute('position', new THREE.BufferAttribute(coinPos, 3));
    const coins = new THREE.Points(coinGeo, new THREE.PointsMaterial({
      color: 0xffd700, size: 0.25, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(coins);

    // Flash offerer and target circles gold
    for (const m of [oM, tM]) {
      if (m.circle) {
        gsap.fromTo(m.circle.material, { color: new THREE.Color(0xffd700), opacity: 1 },
          { opacity: 0.3, duration: 0.4, yoyo: true, repeat: 3, onComplete: () => m.circle.material.color.set(m.color) });
      }
    }

    // Animate coins flowing from offerer to target
    const progress = { t: 0 };
    gsap.to(progress, {
      t: 1, duration: 1.2, ease: 'power2.inOut',
      onUpdate: () => {
        const pos = coins.geometry.attributes.position;
        for (let i = 0; i < coinCount; i++) {
          const pct = Math.min(1, progress.t + (i / coinCount) * 0.1);
          const p = curve.getPoint(Math.min(1, pct));
          pos.setX(i, p.x + Math.sin(pct * 10 + i) * 0.15);
          pos.setY(i, p.y + Math.cos(pct * 8 + i) * 0.15);
          pos.setZ(i, p.z);
        }
        pos.needsUpdate = true;
      },
    });

    this.effects.push({
      mesh: tube, extras: [coins], life: 3.0, decay: 0.5,
      update: (dt, eff) => {
        eff.life -= eff.decay * dt;
        const o = Math.max(0, eff.life * 0.3);
        tube.material.opacity = o;
        tube.material.emissiveIntensity = eff.life * 1.5;
        coins.material.opacity = o;
      },
    });
  }

  _showAlliance(members) {
    if (members.length < 2) return;
    const m0 = this.agentMeshes.get(members[0]), m1 = this.agentMeshes.get(members[1]);
    if (!m0 || !m1) return;
    const p0 = m0.group.position.clone().add(new THREE.Vector3(0, 2.2, 0));
    const p1 = m1.group.position.clone().add(new THREE.Vector3(0, 2.2, 0));
    const mid = p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, 2.0, 0));
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);

    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 30, 0.05, 6, false),
      new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 3.0, transparent: true, opacity: 0.7 }),
    );
    this.scene.add(tube);

    const sPos = new Float32Array(20 * 3);
    for (let i = 0; i < 20; i++) { const p = curve.getPoint(i / 20); sPos[i * 3] = p.x; sPos[i * 3 + 1] = p.y; sPos[i * 3 + 2] = p.z; }
    const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const sparkles = new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0x88ffaa, size: 0.15, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(sparkles);

    for (const m of [m0, m1]) { if (m.circle) gsap.to(m.circle.material, { opacity: 1, duration: 0.3, yoyo: true, repeat: 2 }); }

    this.effects.push({
      mesh: tube, extras: [sparkles], life: 4.0, decay: 0.4,
      update: (dt, eff) => { eff.life -= eff.decay * dt; const o = Math.max(0, eff.life * 0.25); tube.material.opacity = o; tube.material.emissiveIntensity = eff.life; sparkles.material.opacity = o; },
    });
  }

  _updateAgentState(agent) {
    const m = this.agentMeshes.get(agent.id);
    if (!m) return;
    const ratio = Math.max(0, agent.hp / 105);
    const fill = m.hpBar.userData.fill, fillMat = m.hpBar.userData.fillMat;
    if (fill) { fill.scale.x = Math.max(0.01, ratio); fill.position.x = -(1 - ratio) * 0.48; }
    if (fillMat) { fillMat.color.set(ratio > 0.5 ? 0x22c55e : ratio > 0.25 ? 0xeab308 : 0xef4444); }
    if (m.armor && agent.alive) m.armor.material.emissiveIntensity = 0.1 + (1 - ratio) * 0.5;
    if (!agent.alive && m.alive) { m.alive = false; m.circle.material.opacity = 0; m.disc.material.opacity = 0; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATION LOOP
  // ═══════════════════════════════════════════════════════════════════════════

  _animate() {
    requestAnimationFrame(() => this._animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.getElapsedTime();

    if (this.controls) this.controls.update();

    // Shake
    if (this.shakeIntensity > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= 0.88;
      if (this.bloomPass) this.bloomPass.strength = 0.7 + this.shakeIntensity * 2;
    } else if (this.bloomPass) this.bloomPass.strength = 0.7;

    // Crystal
    if (this.crystal) { this.crystal.position.y = 5.0 + Math.sin(t * 1.2) * 0.5; this.crystal.rotation.y = t * 0.7; this.crystal.rotation.x = Math.sin(t * 0.4) * 0.25; this.crystal.material.emissiveIntensity = 2.0 + Math.sin(t * 3) * 0.8; }
    if (this.innerCrystal) { this.innerCrystal.position.y = 5.0 + Math.sin(t * 1.2) * 0.5; this.innerCrystal.rotation.y = -t * 1.5; this.innerCrystal.material.emissiveIntensity = 2.5 + Math.sin(t * 4) * 1.0; }
    if (this.crystalRings) for (let i = 0; i < this.crystalRings.length; i++) { const r = this.crystalRings[i]; r.position.y = 5.0 + Math.sin(t * 1.2) * 0.5; r.rotation.x = Math.PI / 2 + Math.sin(t * 0.8 + i * 1.2) * 0.4; r.rotation.z = t * (0.3 + i * 0.2); }
    if (this.energyOrbs) for (const orb of this.energyOrbs) { const a = t * 1.5 + orb.phase; orb.mesh.position.set(2.5 * Math.cos(a), 5.0 + Math.sin(t * 1.2) * 0.5 + Math.sin(a * 2) * 0.4, 2.5 * Math.sin(a)); orb.mesh.material.emissiveIntensity = 2.5 + Math.sin(t * 5 + orb.phase) * 1.5; }
    if (this.centerLight) this.centerLight.intensity = 4.0 + Math.sin(t * 2.5) * 2.0;

    // Torches
    for (const torch of this.torches) {
      torch.light.intensity = 2.5 + Math.sin(t * 12 + Math.random() * 3) * 0.8 + Math.sin(t * 7.3) * 0.3;
      if (torch.core) { torch.core.material.emissiveIntensity = 3.0 + Math.sin(t * 10) * 1.5; torch.core.scale.setScalar(0.9 + Math.sin(t * 8) * 0.15); }
      if (torch.sprites) for (let s = 0; s < torch.sprites.length; s++) { torch.sprites[s].scale.y = 0.8 + Math.sin(t * 6 + s * 2) * 0.2; torch.sprites[s].material.opacity = 0.5 + Math.sin(t * 10 + s * 1.5) * 0.2; }
      if (torch.particles) {
        const pos = torch.particles.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) + dt * (2.0 + Math.random() * 1.5);
          if (y > pos.getY(i) + 0.8) { y = 0; pos.setX(i, (Math.random() - 0.5) * 0.2); pos.setZ(i, (Math.random() - 0.5) * 0.2); }
          pos.setY(i, y);
        }
        pos.needsUpdate = true;
      }
    }

    // Dust
    if (this.dustParticles) { const pos = this.dustParticles.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { pos.setY(i, pos.getY(i) + dt * 0.06); pos.setX(i, pos.getX(i) + Math.sin(t * 0.5 + i * 0.1) * dt * 0.015); if (pos.getY(i) > 15) pos.setY(i, 0); } pos.needsUpdate = true; }

    // Embers
    if (this.embers) { const pos = this.embers.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { pos.setY(i, pos.getY(i) + dt * 0.6); pos.setX(i, pos.getX(i) + Math.sin(t * 2 + i * 0.5) * dt * 0.12); pos.setZ(i, pos.getZ(i) + Math.cos(t * 1.5 + i * 0.3) * dt * 0.08); if (pos.getY(i) > 25) { pos.setY(i, 0); pos.setX(i, (Math.random() - 0.5) * 35); pos.setZ(i, (Math.random() - 0.5) * 35); } } pos.needsUpdate = true; }

    // Warriors
    for (const [, m] of this.agentMeshes) {
      if (!m.alive) continue;
      if (!gsap.isTweening(m.group.position)) m.group.position.y = m.baseY + Math.sin(t * 2.0 + m.index * 1.8) * 0.04;
      if (m.weapon && !gsap.isTweening(m.weapon.rotation)) m.weapon.rotation.z = Math.sin(t * 1.2 + m.index * 0.8) * 0.06;
      if (m.hpBar) m.hpBar.lookAt(this.camera.position);
      if (m.armor) m.armor.material.emissiveIntensity = Math.max(m.armor.material.emissiveIntensity, 0.05 + Math.sin(t * 3 + m.index * 2) * 0.05);
    }

    // Effects
    this.effects = this.effects.filter((eff) => {
      eff.update(dt, eff);
      if (eff.life <= 0) {
        this.scene.remove(eff.mesh);
        if (eff.mesh.geometry) eff.mesh.geometry.dispose();
        if (eff.mesh.material) eff.mesh.material.dispose();
        if (eff.extras) eff.extras.forEach((e) => { this.scene.remove(e); if (e.geometry) e.geometry.dispose(); if (e.material) e.material.dispose(); });
        return false;
      }
      return true;
    });

    // Render
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
    if (this.fxaaPass) { const pr = this.renderer.getPixelRatio(); this.fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr)); }
  }

  dispose() { this.renderer.dispose(); }
}
