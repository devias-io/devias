import { cn } from '@devias/ui';
import { useEffect, useRef, useState } from 'react';

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * Reeded glass over the picture: a row of narrow vertical lenses, each pulling in a little of its neighbours; waves
 * that run down the reeds; a vertical smear whose length differs from one reed to the next; a faint colour fringe; and
 * a ripple that spreads from the pointer.
 */
const FRAGMENT = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uRes;      // the canvas, in pixels
uniform vec2 uImg;      // the picture, in pixels
uniform float uStrips;  // how many reeds across
uniform float uTime;
uniform vec2 uPointer;  // 0..1 across the canvas, y down
uniform float uGain;    // how strong the pointer's ripple is right now

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

// A point on the canvas (0..1, y down) to the picture's own, filling the canvas like object-fit: cover.
vec2 cover(vec2 uv) {
  float canvasRatio = uRes.x / uRes.y;
  float imageRatio = uImg.x / uImg.y;
  vec2 scale = canvasRatio > imageRatio ? vec2(1.0, imageRatio / canvasRatio) : vec2(canvasRatio / imageRatio, 1.0);
  return (uv - 0.5) * scale + 0.5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  uv.y = 1.0 - uv.y;

  float id = floor(uv.x * uStrips);
  float f = fract(uv.x * uStrips);

  // Each reed is a small lens: its middle shows the picture straight, its sides pull in from beside it.
  float dx = (f - 0.5) * 1.7 / uStrips;
  // Slow waves run down the reeds, each out of step with the others so they do not line up into a pattern.
  float phase = hash(id) * 6.2831;
  float wave = sin(uv.y * 6.0 + uTime * 0.45 + phase) * 0.5 + sin(uv.y * 15.0 - uTime * 0.3 + phase * 2.3) * 0.25;
  dx += wave * 0.009 * (0.5 + hash(id + 1.0));

  // The pointer's ripple: rings that fade with distance, pushing the reeds sideways.
  vec2 p = (uv - uPointer) * vec2(uRes.x / uRes.y, 1.0);
  float d = length(p);
  dx += sin(d * 36.0 - uTime * 3.2) * exp(-d * 4.5) * 0.022 * uGain;

  // Smeared down each reed, further on some than on others.
  float smear = 0.05 + 0.06 * hash(id + 3.0);
  float drift = 0.02 * sin(uTime * 0.2 + id);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float t = float(i) / 11.0 - 0.5;
    col += texture2D(uTex, cover(vec2(uv.x + dx, uv.y + t * smear + drift))).rgb;
  }
  col /= 12.0;

  // A faint colour fringe along the reeds.
  vec2 centre = cover(vec2(uv.x + dx, uv.y + drift));
  col.r = mix(col.r, texture2D(uTex, centre + vec2(0.0035, 0.0)).r, 0.5);
  col.b = mix(col.b, texture2D(uTex, centre - vec2(0.0035, 0.0)).b, 0.5);

  // Where two reeds meet it is darker, and each reed is a touch lighter or darker than the next.
  float edge = smoothstep(0.0, 0.14, f) * smoothstep(1.0, 0.86, f);
  col *= (0.86 + 0.14 * edge) * (0.96 + 0.1 * hash(id + 7.0)) * 1.1;

  gl_FragColor = vec4(col, 1.0);
}
`;

const compile = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type);

  if (!shader) {
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }

  gl.deleteShader(shader);

  return null;
};

/** The width of one reed on screen, in CSS pixels. */
const REED = 15;
/** Draw at most this many device pixels per CSS pixel: the effect is soft, so a sharp edge is not worth the cost. */
const MAX_DPR = 1.25;
/** Draw at most this often; the waves are slow. */
const FRAME_MS = 1000 / 40;

/**
 * A picture seen through reeded glass, drawn with WebGL: it ripples slowly, and more where the pointer moves over its
 * parent. The plain picture sits underneath and stays when WebGL is not there, or when the person prefers less
 * motion, in which case the glass is drawn once and does not move. Fills its (positioned) parent.
 */
export function RippleImage({ src, className }: { src: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;

    if (!canvas || !host) {
      return;
    }

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });

    if (!gl) {
      return;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();

    if (!vertex || !fragment || !program) {
      return;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return;
    }

    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's `useProgram`, not a React hook
    gl.useProgram(program);

    // One triangle that covers the canvas.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const u = {
      res: uniform('uRes'),
      img: uniform('uImg'),
      strips: uniform('uStrips'),
      time: uniform('uTime'),
      pointer: uniform('uPointer'),
      gain: uniform('uGain'),
    };

    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, gain: 0, target: 0 };
    let frame = 0;
    let last = 0;
    let loaded = false;
    let stopped = false;
    let texture: WebGLTexture | null = null;

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = Math.max(1, Math.round(host.clientWidth * dpr));
      const height = Math.max(1, Math.round(host.clientHeight * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      gl.viewport(0, 0, width, height);
      gl.uniform2f(u.res, width, height);
      gl.uniform1f(u.strips, Math.max(8, host.clientWidth / REED));
    };

    const draw = (seconds: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.12;
      pointer.y += (pointer.ty - pointer.y) * 0.12;
      pointer.gain += (pointer.target - pointer.gain) * 0.06;
      gl.uniform1f(u.time, seconds);
      gl.uniform2f(u.pointer, pointer.x, pointer.y);
      gl.uniform1f(u.gain, pointer.gain);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const tick = (now: number) => {
      if (stopped) {
        return;
      }

      frame = requestAnimationFrame(tick);

      if (now - last < FRAME_MS) {
        return;
      }

      last = now;
      // The pointer's ripple dies away once it is still.
      pointer.target *= 0.985;
      draw(now / 1000);
    };

    const move = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.tx = (event.clientX - rect.left) / rect.width;
      pointer.ty = (event.clientY - rect.top) / rect.height;
      pointer.target = 1;
    };

    const observer = new ResizeObserver(() => {
      if (!loaded) {
        return;
      }

      size();

      if (reduced) {
        draw(2);
      }
    });

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (stopped) {
        return;
      }

      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      // Not a power of two, so no mipmaps and no repeat.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(uniform('uTex'), 0);
      gl.uniform2f(u.img, image.naturalWidth, image.naturalHeight);
      loaded = true;
      size();
      draw(2);
      setReady(true);
      observer.observe(host);

      if (reduced) {
        return;
      }

      host.addEventListener('pointermove', move);
      frame = requestAnimationFrame(tick);
    };
    image.src = src;

    const lost = (event: Event) => {
      event.preventDefault();
      stopped = true;
      cancelAnimationFrame(frame);
      setReady(false);
    };
    canvas.addEventListener('webglcontextlost', lost);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener('pointermove', move);
      canvas.removeEventListener('webglcontextlost', lost);
      // Free what this run made, but leave the context alive: a second run (React's strict mode) gets the same one back.
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [src]);

  return (
    <>
      <img src={src} alt="" decoding="async" className={cn('absolute inset-0 size-full object-cover', className)} />
      <canvas
        ref={canvasRef}
        className={cn(
          'absolute inset-0 size-full transition-opacity duration-700',
          ready ? 'opacity-100' : 'opacity-0',
        )}
      />
    </>
  );
}
