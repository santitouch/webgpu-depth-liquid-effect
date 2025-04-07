// Project: WebGPU Depth Dot Projection + Subtle Liquid Distortion (on hover only)

const vertexShaderWGSL = `
struct VertexOutput {
    @builtin(position) Position : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
    var pos = array<vec2<f32>, 6>(
        vec2(-1.0, -1.0),
        vec2( 1.0, -1.0),
        vec2(-1.0,  1.0),
        vec2(-1.0,  1.0),
        vec2( 1.0, -1.0),
        vec2( 1.0,  1.0)
    );

    var uv = array<vec2<f32>, 6>(
        vec2(0.0, 1.0),
        vec2(1.0, 1.0),
        vec2(0.0, 0.0),
        vec2(0.0, 0.0),
        vec2(1.0, 1.0),
        vec2(1.0, 0.0)
    );

    var output : VertexOutput;
    output.Position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
    output.uv = uv[vertexIndex];
    return output;
}`;

const fragmentShaderWGSL = `
@group(0) @binding(0) var sampler0 : sampler;
@group(0) @binding(1) var img : texture_2d<f32>;
@group(0) @binding(2) var depthMap : texture_2d<f32>;
@group(0) @binding(3) var<uniform> mouseData : vec4<f32>; // x, y, inside, time

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p ,vec2<f32>(12.9898,78.233))) * 43758.5453);
}

fn palette(t: f32) -> vec3<f32> {
  return mix(vec3<f32>(1.0, 0.0, 0.6), vec3<f32>(0.0, 0.0, 0.8), 0.5 + 0.5 * sin(t * 2.0));
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let time = mouseData.w;
    let mouse = mouseData.xy;
    let isHovering = mouseData.z;
    let depth = textureSample(depthMap, sampler0, uv).r;

    var distUV = uv;
    if (isHovering > 0.5) {
        let offset = vec2<f32>(0.01 * sin(uv.y * 15.0 + time), 0.01 * cos(uv.x * 15.0 + time));
        distUV += offset * 0.5;
    }

    let baseColor = textureSample(img, sampler0, distUV);

    let gridUV = uv * vec2(400.0);
    let rand = hash(floor(gridUV));
    let dotSize = 0.01 + 0.02 * rand;
    let shimmer = 0.5 + 0.5 * sin(time * (2.0 + rand * 2.5));
    let dotMask = smoothstep(dotSize * 1.5, dotSize, distance(fract(gridUV), vec2(0.5))) * shimmer;
    let depthDotMask = smoothstep(0.99, 0.01, depth);

    let distToMouse = distance(uv, mouse);
    let circularMask = smoothstep(0.3, 0.0, distToMouse);

    let dotColor = palette(time + rand * 10.0);
    let glow = smoothstep(dotSize * 1.3, 0.0, distance(fract(gridUV), vec2(0.5))) * 0.08;
    let dot = (dotColor * dotMask + dotColor * glow) * depthDotMask * circularMask;

    return vec4<f32>(baseColor.rgb + dot, 1.0);
}`;

// (Canvas logic, WebGPU pipeline setup, texture loading, etc. stay as-is from previous version)

const canvas = document.getElementById('webgpu-canvas');
const mouse = { x: 0.5, y: 0.5, inside: 0 };

function resizeCanvasToDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width  = canvas.clientWidth  * dpr;
  const height = canvas.clientHeight * dpr;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width  = width;
    canvas.height = height;
  }
}

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) / rect.width;
  mouse.y = (e.clientY - rect.top) / rect.height;
});
canvas.addEventListener('mouseenter', () => mouse.inside = 1);
canvas.addEventListener('mouseleave', () => mouse.inside = 0);

async function init() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");

  resizeCanvasToDisplaySize(canvas);

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque", size: [canvas.width, canvas.height] });

  const imgTexture = await loadTexture(device, './assets/image2.jpg');
  const depthTexture = await loadTexture(device, './assets/depth2.jpg');

  const vertexModule = device.createShaderModule({ code: vertexShaderWGSL });
  const fragmentModule = device.createShaderModule({ code: fragmentShaderWGSL });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: vertexModule, entryPoint: 'main' },
    fragment: { module: fragmentModule, entryPoint: 'main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const uniformBuffer = device.createBuffer({
    size: 4 * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: imgTexture.createView() },
      { binding: 2, resource: depthTexture.createView() },
      { binding: 3, resource: { buffer: uniformBuffer } },
    ],
  });

  function frame() {
    resizeCanvasToDisplaySize(canvas);
    const time = performance.now() / 1000;
    const mouseData = new Float32Array([mouse.x, mouse.y, mouse.inside, time]);
    device.queue.writeBuffer(uniformBuffer, 0, mouseData.buffer);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, 1, 0, 0);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  frame();
}

async function loadTexture(device, url) {
  const img = new Image();
  img.src = url;
  img.crossOrigin = "anonymous";
  await img.decode();
  const bitmap = await createImageBitmap(img);

  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    [bitmap.width, bitmap.height]
  );

  return texture;
}

init();
