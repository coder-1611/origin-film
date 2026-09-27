import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for (const mode of [true]) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: mode,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080 });
  await p.setContent('<canvas id=c width=1920 height=1080></canvas>');
  const r = await p.evaluate(async () => {
    const c = document.getElementById('c'); const gl = c.getContext('webgl2', { preserveDrawingBuffer: true });
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const info = { renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
      cbf: !!gl.getExtension('EXT_color_buffer_float'), flf: !!gl.getExtension('OES_texture_float_linear'), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    // heavy shader timing: 64-step fbm raymarch fullscreen
    const vs = `#version 300 es
    in vec2 p; void main(){ gl_Position = vec4(p,0,1); }`;
    const fs = `#version 300 es
    precision highp float; out vec4 o; uniform float T;
    float h(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
    float n(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
      return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
    float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5;} return s; }
    void main(){ vec2 uv=gl_FragCoord.xy/vec2(1920.,1080.); vec3 ro=vec3(0,0,T), rd=normalize(vec3(uv*2.-1.,1.5)); float acc=0.;
      for(int i=0;i<64;i++){ vec3 q=ro+rd*float(i)*.08; acc+=fbm(q)*.02; } o=vec4(vec3(acc),1); }`;
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(sh); return sh; };
    const pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const px = new Uint8Array(4); const t0 = performance.now();
    for (let i = 0; i < 10; i++) { gl.uniform1f(gl.getUniformLocation(pr,'T'), i); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); }
    info.msPerHeavyFrame = ((performance.now() - t0) / 10).toFixed(1);
    return info;
  });
  const t0 = Date.now(); for (let i = 0; i < 5; i++) await p.screenshot({ type: 'jpeg', quality: 95, optimizeForSpeed: true }); 
  r.msPerScreenshot = (Date.now() - t0) / 5;
  console.log('headless=' + mode, JSON.stringify(r));
  await b.close();
}
