import { useEffect, useRef } from 'react';
import { vertexNormals, type Body3D } from '../lib/body';

import { t } from '../i18n';
const VERTEX = `#version 300 es
in vec3 position;
in vec3 normal;
uniform mat3 turn;
uniform float scale;
uniform float aspect;
out vec3 side;
void main() {
  vec3 p = turn * position;
  side = turn * normal;
  gl_Position = vec4(p.x * scale / aspect, p.y * scale, -p.z * scale * 0.4, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 side;
uniform vec3 light;
uniform vec3 paper;
uniform vec3 ink;
out vec4 color;
void main() {
  vec3 n = normalize(side);
  if (!gl_FrontFacing) n = -n;
  // Dos tonos y una transición corta: se lee como un estudio de valores, no como plástico.
  float v = max(0.0, dot(n, light));
  float tone = 0.32 + 0.68 * smoothstep(0.0, 0.5, v);
  color = vec4(mix(ink, paper, tone), 1.0);
}`;

function compile(gl: WebGL2RenderingContext) {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(p);
  return p;
}

function rotation(yaw: number, pitch: number): Float32Array {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Columnas de Rx(pitch) · Ry(yaw).
  return new Float32Array([cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy]);
}

const hex = (v: string): [number, number, number] => {
  const n = parseInt(v.trim().slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** El cuerpo reconstruido: se gira con el dedo para verlo desde cualquier lado. */
export function BodyView({ body }: { body: Body3D }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const turn = useRef({ yaw: 0, pitch: 0 });
  const paint = useRef<() => void>(() => {});
  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!gl) return;
    let alive = true;
    void fetch(`${import.meta.env.BASE_URL}models/mhr-faces.bin`)
      .then((r) => r.arrayBuffer())
      .then((buffer) => {
        if (!alive) return;
        const faces = new Int32Array(buffer);
        const count = body.vertices.length / 3;
        // Pantalla: y hacia abajo y z hacia el fondo. WebGL los quiere al revés.
        const pos = new Float32Array(count * 3);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        for (let i = 0; i < count; i++) {
          x0 = Math.min(x0, body.vertices[i * 3]);
          x1 = Math.max(x1, body.vertices[i * 3]);
          y0 = Math.min(y0, body.vertices[i * 3 + 1]);
          y1 = Math.max(y1, body.vertices[i * 3 + 1]);
          z0 = Math.min(z0, body.vertices[i * 3 + 2]);
          z1 = Math.max(z1, body.vertices[i * 3 + 2]);
        }
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        const mz = (z0 + z1) / 2;
        let reach = 0;
        for (let i = 0; i < count; i++) {
          const x = body.vertices[i * 3] - mx;
          const y = body.vertices[i * 3 + 1] - my;
          const z = body.vertices[i * 3 + 2] - mz;
          pos[i * 3] = x;
          pos[i * 3 + 1] = -y;
          pos[i * 3 + 2] = -z;
          reach = Math.max(reach, Math.hypot(x, y, z));
        }
        const raw = vertexNormals(body.vertices, faces);
        const normals = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          normals[i * 3] = raw[i * 3];
          normals[i * 3 + 1] = -raw[i * 3 + 1];
          normals[i * 3 + 2] = -raw[i * 3 + 2];
        }
        const program = compile(gl);
        gl.useProgram(program);
        const bind = (name: string, data: Float32Array) => {
          gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
          gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          const at = gl.getAttribLocation(program, name);
          gl.enableVertexAttribArray(at);
          gl.vertexAttribPointer(at, 3, gl.FLOAT, false, 0, 0);
        };
        bind('position', pos);
        bind('normal', normals);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(faces.buffer), gl.STATIC_DRAW);
        gl.enable(gl.DEPTH_TEST);
        const dir = body.light?.dir ?? [-0.5, -0.6, 0.6];
        const css = getComputedStyle(document.documentElement);
        paint.current = () => {
          const k = window.devicePixelRatio || 1;
          const w = Math.max(1, Math.round(canvas.clientWidth * k));
          const h = Math.max(1, Math.round(canvas.clientHeight * k));
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          gl.viewport(0, 0, w, h);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          const m = rotation(turn.current.yaw, turn.current.pitch);
          gl.uniformMatrix3fv(gl.getUniformLocation(program, 'turn'), false, m);
          gl.uniform1f(gl.getUniformLocation(program, 'scale'), 0.94 / reach);
          gl.uniform1f(gl.getUniformLocation(program, 'aspect'), w / h);
          // La luz se queda en la escena: al girar el cuerpo cambia lo que ilumina.
          const lx = dir[0];
          const ly = -dir[1];
          const lz = dir[2];
          gl.uniform3f(gl.getUniformLocation(program, 'light'), m[0] * lx + m[3] * ly + m[6] * lz, m[1] * lx + m[4] * ly + m[7] * lz, m[2] * lx + m[5] * ly + m[8] * lz);
          gl.uniform3fv(gl.getUniformLocation(program, 'paper'), hex(css.getPropertyValue('--paper-2') || '#e9e4d8'));
          gl.uniform3fv(gl.getUniformLocation(program, 'ink'), [0.16, 0.15, 0.14]);
          gl.drawElements(gl.TRIANGLES, faces.length, gl.UNSIGNED_INT, 0);
        };
        paint.current();
      });
    return () => {
      alive = false;
    };
  }, [body]);

  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  return (
    <figure className="bodyview">
      <canvas
        ref={ref}
        role="img"
        aria-label={t('bodyView.cuerpo_reconstruido_en_3d')}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ...turn.current };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          turn.current = { yaw: d.yaw + (e.clientX - d.x) * 0.012, pitch: Math.max(-1.4, Math.min(1.4, d.pitch + (e.clientY - d.y) * 0.012)) };
          paint.current();
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => {
          turn.current = { yaw: 0, pitch: 0 };
          paint.current();
        }}
      />
      <figcaption>{t('bodyView.arrastra_para_girarlo_doble')}</figcaption>
    </figure>
  );
}
