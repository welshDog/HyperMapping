import { LOOK_STYLES, paletteFor, speedFor, type Look } from './look';

/** Full-screen triangle from gl_VertexID: no vertex buffer needed. */
export const VERTEX_SRC = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * One fragment shader for every look. Index 0 of each look uniform array is the current look,
 * index 1 the previous one. Deterministic in its uniforms: no clocks, no randomness.
 */
export const FRAGMENT_SRC = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_res;
uniform float u_time;
uniform float u_fade;
uniform float u_pulse;  // bass level 0..1 (faded when stale)
uniform float u_treble; // treble level 0..1
uniform float u_atime;  // extra shader seconds earned by loudness (never goes backwards)
uniform int u_octaves; // 5 normally, 3 in cheap mode (phones)
uniform int u_style[2];
uniform float u_seed[2];
uniform float u_speed[2];
uniform vec3 u_pa[2];
uniform vec3 u_pb[2];
uniform vec3 u_pc[2];
uniform vec3 u_pd[2];

const float TAU = 6.28318530718;
const float PI = 3.14159265359;

// ---------- hashing (integer, no sin) ----------
uint hashU(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
float hash1u(uint x) { return float(hashU(x) >> 8) / 16777216.0; }
float hash2i(ivec2 c, uint s) {
  return hash1u(uint(c.x) * 0x8da6b343u ^ uint(c.y) * 0xd8163841u ^ s * 0xcb1ab31fu);
}
vec2 hash22i(ivec2 c, uint s) {
  return vec2(hash2i(c, s), hash2i(c, s ^ 0x5bd1e995u));
}

// ---------- gradient noise + fbm ----------
vec2 grad(ivec2 c, uint s) {
  uint h = hashU(uint(c.x) * 0x8da6b343u ^ uint(c.y) * 0xd8163841u ^ s * 0xcb1ab31fu);
  return vec2(float(h & 0xffffu), float(h >> 16)) / 32767.5 - 1.0;
}
float gnoise(vec2 p, uint s) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  ivec2 c = ivec2(i);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n0 = dot(grad(c, s), f);
  float n1 = dot(grad(c + ivec2(1, 0), s), f - vec2(1.0, 0.0));
  float n2 = dot(grad(c + ivec2(0, 1), s), f - vec2(0.0, 1.0));
  float n3 = dot(grad(c + ivec2(1, 1), s), f - vec2(1.0, 1.0));
  return mix(mix(n0, n1, u.x), mix(n2, n3, u.x), u.y); // about -0.7..0.7
}

// up to 5 octaves (u_octaves), rotated each octave; returns roughly 0..1
float fbm(vec2 p, uint s) {
  const mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= u_octaves) break;
    v += amp * gnoise(p, s + uint(i));
    p = R * p * 2.03 + vec2(17.1, 9.3);
    amp *= 0.5;
  }
  return 0.5 + v;
}

vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// ---------- plasma: domain-warped fbm ----------
vec3 lookPlasma(vec2 p, float t, uint s, float pulse, vec3 a, vec3 b, vec3 c, vec3 d) {
  vec2 off = vec2(hash1u(s), hash1u(s + 7u)) * 50.0;
  float warp = 2.0 + 2.5 * hash1u(s + 13u);   // calm marble .. wild swirl
  warp *= 1.0 + 0.5 * u_pulse;                 // bass: the swirl surges
  float span = 0.6 + 0.9 * hash1u(s + 17u);   // how many palette hues show at once
  p = p * (1.1 + 1.0 * hash1u(s + 3u)) / pulse + off;
  float tt = t * 0.12;
  vec2 q = vec2(fbm(p + vec2(0.0, tt), s), fbm(p + vec2(5.2, 1.3) - vec2(tt, 0.0), s + 11u));
  vec2 r = vec2(fbm(p + warp * q + vec2(1.7, 9.2) + 0.7 * tt, s + 23u),
                fbm(p + warp * q + vec2(8.3, 2.8) - 0.5 * tt, s + 31u));
  float f = fbm(p + warp * r, s + 41u);
  float idx = span * (f * 1.4 + 0.6 * length(q) + 0.35 * r.x) + 0.04 * t + hash1u(s + 19u);
  vec3 col = pal(idx, a, b, c, d);
  // second palette tap for richness in the warp folds
  vec3 col2 = pal(idx + span * (0.33 + 0.5 * r.y), a, b, c, d);
  col = mix(col, col2, smoothstep(0.35, 0.75, q.y));
  // light/dark contrast from the field, shiny ridges where the warp folds
  float shade = smoothstep(0.15, 0.85, f);
  col *= 0.5 + 1.0 * shade;
  float ridge = pow(1.0 - abs(2.0 * fract(f * 3.0 + 0.2 * tt) - 1.0), 6.0);
  col += 0.35 * ridge * pal(idx + 0.5, a, b, c, d) * (1.0 + 1.2 * u_pulse); // bass: ridges flash
  // treble: crisper light/dark plus hairline contour shimmer (a high-octave term on the field)
  if (u_treble > 0.0) {
    float fine = gnoise(p * 16.0 + vec2(0.0, tt * 8.0), s + 59u);
    float hair = pow(1.0 - abs(2.0 * fract(f * 9.0 + 0.6 * fine) - 1.0), 12.0);
    col *= 1.0 + u_treble * 0.6 * (shade - 0.5);
    col += u_treble * 0.9 * hair * pal(idx + 0.5, a, b, c, d);
  }
  return col * pulse * (1.0 + 0.12 * u_pulse);
}

// ---------- kaleidoscope: polar fold ----------
vec3 lookKaleido(vec2 p, float t, uint s, float pulse, vec3 a, vec3 b, vec3 c, vec3 d) {
  float n = 5.0 + floor(hash1u(s + 101u) * 8.0); // 5..12
  float dir = hash1u(s + 103u) < 0.5 ? -1.0 : 1.0;
  p = rot(dir * t * 0.08) * p;
  float rad = length(p) / pulse / (1.0 + 0.2 * u_pulse); // bass: breathing zoom
  float ang = atan(p.y, p.x);
  float seg = TAU / n;
  ang = mod(ang, seg);
  ang = abs(ang - 0.5 * seg);
  vec2 k = vec2(cos(ang), sin(ang)) * rad;
  vec2 off = vec2(hash1u(s + 5u), hash1u(s + 9u)) * 40.0;
  float zoom = 2.2 + 1.5 * hash1u(s + 107u);
  vec2 kk = k * zoom + off + vec2(-t * 0.18, t * 0.05);
  float f = fbm(kk, s);
  float g = fbm(kk * 1.7 + f * 2.0 + vec2(3.1, -t * 0.1), s + 50u);
  float ringFreq = 10.0 + 14.0 * hash1u(s + 109u);
  float rings = 0.5 + 0.5 * cos(rad * ringFreq - t * 1.2 + f * 7.0);
  float lines = smoothstep(0.92, 1.0, rings);
  vec3 col = pal(g * 1.3 + rad * 0.5 - t * 0.05, a, b, c, d);
  col *= 0.25 + 1.0 * smoothstep(0.25, 0.8, g) + 0.35 * pow(rings, 3.0) * (1.0 + 2.5 * u_pulse); // bass: rings pulse
  col += lines * pal(g + 0.5, a, b, c, d) * 0.9 * (1.0 + 1.2 * u_pulse);
  // treble: bright glints on the petals (thresholded high-frequency noise in the folded space)
  if (u_treble > 0.0) {
    float gn = gnoise(kk * 5.0 + vec2(t * 1.5, -t * 0.7), s + 71u);
    float glint = smoothstep(0.28, 0.5, gn) * smoothstep(0.03, 0.12, rad);
    col += u_treble * 2.2 * glint * mix(pal(g + 0.25, a, b, c, d), vec3(1.0), 0.5);
  }
  // bright jewel at the fold seams
  float seam = exp(-ang * rad * 60.0) * smoothstep(0.02, 0.2, rad);
  col += seam * 0.4 * pal(rad - t * 0.1 + 0.25, a, b, c, d);
  // soft central glow
  col += exp(-rad * 6.0) * 0.6 * pal(t * 0.03, a, b, c, d);
  return col * pulse;
}

// ---------- neon: polygon tunnel + perspective grid ----------
vec3 lookNeon(vec2 p, float t, uint s, float pulse, vec3 a, vec3 b, vec3 c, vec3 d) {
  float sides = 3.0 + floor(hash1u(s + 201u) * 6.0); // 3..8
  bool circle = hash1u(s + 203u) < 0.2;
  vec2 tp = p - vec2(0.0, 0.08);
  float spin = (hash1u(s + 205u) - 0.5) * 0.6;
  float ang = atan(tp.y, tp.x) + t * spin;
  float r = length(tp);
  float rp = r;
  if (!circle) {
    float seg = TAU / sides;
    rp = r * cos(mod(ang + 0.5 * seg, seg) - 0.5 * seg) / cos(0.5 * seg);
  }
  rp /= pulse * (1.0 + 0.3 * u_pulse); // bass: the rings expand
  float depth = 0.35 / max(rp, 1e-3);
  float z = depth + t * 0.9;
  float ringId = floor(z);
  // distance to the nearest ring in screen units (d depth / d rp = 0.35 / rp^2)
  float sd = abs(fract(z) - 0.5) * rp * rp / 0.35;
  float wdt = (0.0025 + 0.006 * rp) * (1.0 + 1.2 * u_pulse); // bass: the glow swells
  float glow = exp(-sd / wdt * 1.2) * 1.6 * (1.0 + 0.9 * u_treble) + wdt * 0.9 / (sd + wdt) * 0.55 * (1.0 + 0.8 * u_pulse);
  float fog = smoothstep(0.015, 0.25, rp);
  vec3 ringCol = pal(hash1u(uint(int(ringId)) ^ s) * 0.6 + t * 0.03, a, b, c, d);
  vec3 col = ringCol * glow * fog * (0.6 + 1.2 * rp);
  // spokes along the tunnel corners
  if (!circle) {
    float seg = TAU / sides;
    float sp = abs(mod(ang + 0.5 * seg, seg) - 0.5 * seg) * r;
    col += pal(0.7 + t * 0.02, a, b, c, d) * exp(-sp * 260.0) * 0.5 * fog * (1.0 + 2.0 * u_treble); // treble: brighter edges
  }
  // perspective grid floor
  // g and fwidth(g) are computed for every pixel (derivatives need uniform control flow);
  // only the result is masked to below the horizon.
  float horizon = -0.12;
  float h = max(horizon - p.y, 1e-3);
  float gz = 0.3 / h;
  vec2 g = vec2(p.x * gz * 1.4, gz + t * 1.6);
  vec2 w = fwidth(g) * 1.2 + 0.015;
  if (p.y < horizon) {
    vec2 gd = abs(fract(g) - 0.5);
    float line = max(smoothstep(0.5 - w.x * 1.5, 0.5, gd.x), smoothstep(0.5 - w.y * 1.5, 0.5, gd.y));
    float gfog = exp(-gz * 0.18) * smoothstep(0.0, 0.05, h);
    // treble: grid lines flicker, each row on its own beat-free shimmer
    float flick = hash1u(uint(int(floor(g.y))) * 747796405u ^ uint(int(floor(t * 24.0))) ^ s);
    col += pal(0.15 + gz * 0.03, a, b, c, d) * line * gfog * 1.3 * (1.0 + u_treble * (0.4 + 2.2 * flick));
  }
  // horizon haze
  col += pal(0.4, a, b, c, d) * exp(-abs(p.y - horizon) * 18.0) * 0.35;
  // deep background so the glow reads
  col += vec3(0.02, 0.01, 0.04);
  return col * pulse;
}

// ---------- particles: 3 parallax layers of hashed cells ----------
vec3 lookParticles(vec2 p, float t, uint s, float pulse, vec3 a, vec3 b, vec3 c, vec3 d) {
  float modeF = hash1u(s + 301u);
  int mode = modeF < 0.34 ? 0 : (modeF < 0.67 ? 1 : 2); // 0 fireflies, 1 stars, 2 rain
  vec3 bgTop = pal(0.1, a, b, c, d) * 0.10;
  vec3 bgBot = pal(0.6, a, b, c, d) * 0.22;
  vec3 col = mix(bgBot, bgTop, smoothstep(-0.6, 0.6, p.y));
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float scale = 14.0 - fl * 4.0; // far layer = many small, near = few big
    float near = (fl + 1.0) / 3.0;
    uint ls = s * 3u + uint(L) * 977u;
    vec2 vel;
    if (mode == 2) vel = vec2(0.15, -2.2 - fl * 1.2);
    else if (mode == 1) vel = vec2(0.05 + fl * 0.05, 0.0);
    else vel = vec2(0.08, 0.12) * (0.5 + fl);
    vec2 q = p * scale - vel * t * 0.6 + vec2(fl * 13.7, fl * 7.3);
    ivec2 cell = ivec2(floor(q));
    vec2 f = fract(q);
    float occ = hash2i(cell, ls + 1u);
    float density = mode == 1 ? 0.55 : 0.35;
    if (occ < density) {
      vec2 h = hash22i(cell, ls);
      float ph = hash2i(cell, ls + 2u) * TAU;
      vec2 pos = 0.25 + 0.5 * h;
      if (mode == 0) pos += 0.12 * vec2(sin(t * 0.9 + ph), cos(t * 0.7 + ph * 1.3));
      vec2 dv = f - pos;
      float size = (0.06 + 0.05 * near) * pulse * (1.0 + 0.3 * u_pulse); // bass: bigger dots
      float br;
      if (mode == 2) {
        dv.y *= 0.12;
        dv.x *= 1.0;
        br = exp(-dot(dv, dv) / (size * size * 0.15));
      } else if (mode == 1) {
        float d2 = length(dv);
        br = exp(-d2 * d2 / (size * size * 0.12));
        float fl8 = 8.0 / (1.0 + 1.0 * u_treble); // treble: longer cross flares
        br += 0.6 * exp(-abs(dv.x) * 60.0) * exp(-abs(dv.y) * fl8) * near * (1.0 + u_treble); // star cross
        br += 0.6 * exp(-abs(dv.y) * 60.0) * exp(-abs(dv.x) * fl8) * near * (1.0 + u_treble);
      } else {
        float d2 = length(dv);
        br = exp(-d2 * d2 / (size * size)) * 0.9 + 0.12 / (1.0 + d2 * d2 * 300.0);
      }
      float tw = 0.55 + 0.45 * sin(t * (1.5 + 3.0 * h.x) + ph);
      if (u_treble > 0.0) {
        // treble: fast, deep twinkle and a cross flare on every particle
        float fast = 0.5 + 0.5 * sin(t * (11.0 + 9.0 * h.y) + ph * 3.0);
        tw *= 1.0 + u_treble * (1.6 * fast * fast - 0.45);
        if (mode != 1) br += u_treble * 0.55 * near * (exp(-abs(dv.x) * 50.0) * exp(-abs(dv.y) * 6.0) + exp(-abs(dv.y) * 50.0) * exp(-abs(dv.x) * 6.0));
      }
      // grown dots and flares must not show their cell's square edge: fade to 0 at the border
      float react = max(u_pulse, u_treble);
      if (react > 0.0) {
        float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
        br *= 1.0 - react * (1.0 - smoothstep(0.0, 0.2, edge));
      }
      vec3 pc = pal(hash2i(cell, ls + 3u) * 0.5 + fl * 0.15 + t * 0.02, a, b, c, d);
      col += pc * br * tw * (0.6 + 0.9 * near) * 1.8 * (1.0 + 0.9 * u_pulse); // bass: brighter
    }
  }
  return col;
}

vec3 renderLook(int style, float seedF, float speed, vec3 a, vec3 b, vec3 c, vec3 d, vec2 p) {
  uint s = uint(seedF);
  float t = (u_time + u_atime) * speed;
  float pulse = 1.0 + 0.15 * u_pulse;
  if (style == 0) return lookPlasma(p, t, s, pulse, a, b, c, d);
  if (style == 1) return lookKaleido(p, t, s, pulse, a, b, c, d);
  if (style == 2) return lookNeon(p, t, s, pulse, a, b, c, d);
  return lookParticles(p, t, s, pulse, a, b, c, d) * pulse;
}

void main() {
  vec2 frag = v_uv * u_res;
  vec2 p = (frag - 0.5 * u_res) / u_res.y; // centred, aspect-correct, y in -0.5..0.5
  vec3 col = renderLook(u_style[0], u_seed[0], u_speed[0], u_pa[0], u_pb[0], u_pc[0], u_pd[0], p);
  if (u_fade < 1.0) {
    vec3 prev = renderLook(u_style[1], u_seed[1], u_speed[1], u_pa[1], u_pb[1], u_pc[1], u_pd[1], p);
    col = mix(prev, col, clamp(u_fade, 0.0, 1.0));
  }
  col = max(col, 0.0);
  // gentle tone map: linear below the knee, soft shoulder above it
  const float K = 0.7;
  vec3 over = max(col - K, 0.0);
  col = min(col, K) + (1.0 - K) * (1.0 - exp(-over / (1.0 - K)));
  // soft vignette
  vec2 uv = v_uv;
  float vig = pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.18);
  col *= 0.55 + 0.45 * vig;
  outColor = vec4(col, 1.0);
}
`;

/** Uniforms set once per frame, shared by both looks. */
export const GLOBAL_UNIFORMS = ['u_res', 'u_time', 'u_fade', 'u_pulse', 'u_treble', 'u_atime', 'u_octaves'] as const;
/** Per-look uniform arrays: index 0 = current look, index 1 = previous look. */
export const LOOK_UNIFORMS = ['u_style', 'u_seed', 'u_speed', 'u_pa', 'u_pb', 'u_pc', 'u_pd'] as const;
export type UniformName = (typeof GLOBAL_UNIFORMS)[number] | (typeof LOOK_UNIFORMS)[number];

/** fbm octave counts: full quality, and the cheap mode used on phones/tablets. */
export const FULL_OCTAVES = 5;
export const CHEAP_OCTAVES = 3;

/** The uniform values for one look, ready to hand to WebGL. */
export interface LookUniforms {
  style: number; // index into LOOK_STYLES
  seed: number; // integer 0..2^24-1, exact in a float32
  speed: number;
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  d: [number, number, number];
}

/**
 * Fold a 32-bit seed to 24 bits (exactly representable in a float32 uniform). Mixed first so
 * every bit of the seed influences the result.
 */
export function seedToUniform(seed: number): number {
  let x = seed >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 8;
}

export function lookUniforms(look: Look): LookUniforms {
  const pal = paletteFor(look.seed);
  return {
    style: Math.max(0, LOOK_STYLES.indexOf(look.style)),
    seed: seedToUniform(look.seed),
    speed: speedFor(look.seed),
    a: pal.a,
    b: pal.b,
    c: pal.c,
    d: pal.d,
  };
}
