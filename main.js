// Project: WebGPU Depth Dot Projection + Subtle Glass Lens Zoom Effect

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

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let time = mouseData.w;
    let mouse = mouseData.xy;
    let isOver = mouseData.z;
    let depth = textureSample(depthMap, sampler0, uv).r;
    var baseColor = textureSample(img, sampler0, uv);

    let gridUV = uv * vec2(400.0);
    let rand = hash(floor(gridUV));
    let dotSize = 0.15 + 0.4 * rand;
    let shimmer = 0.5 + 0.5 * sin(time * (1.5 + rand * 3.5));
    let dotMask = smoothstep(0.2, 0.15, distance(fract(gridUV), vec2(0.5))) * shimmer;
    let depthDotMask = smoothstep(1.0, 0.0, depth);
    let dotColor = vec3<f32>(1.0, 0.85, 0.4);
    let glow = smoothstep(0.01, 0.0, distance(fract(gridUV), vec2(0.5))) * 0.25;
    let dot = (dotColor * dotMask + dotColor * glow) * depthDotMask;

    let lensRadius = 0.25;
    let lensDist = distance(uv, mouse);
    let inLens = smoothstep(lensRadius, lensRadius - 0.1, lensDist);
    let zoomUV = mix(uv, mouse + (uv - mouse) * 0.9, inLens);
    let zoomedColor = textureSample(img, sampler0, zoomUV);
    let ring = smoothstep(0.05, 0.045, abs(lensDist - 0.15));
    let lensGlow = vec3<f32>(1.0, 1.0, 1.0) * ring * inLens * 0.1;

    let composed = mix(baseColor.rgb, zoomedColor.rgb, inLens);
    return vec4<f32>(composed + dot + lensGlow, 1.0);
}`;

const canvas = document.getElementById('webgpu-canvas');
const mouse = { x: 0.5, y: 0.5, inside: 0 };

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) / rect.width;
  mouse.y = (e.clientY - rect.top) / rect.height;
});
canvas.addEventListener('mouseenter', () => mouse.inside = 1);
canvas.addEventListener('mouseleave', () => mouse.inside = 0);

async function init() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const imgTexture = await loadTexture(device, './assets/image.png');
  const depthTexture = await loadTexture(device, './assets/depth.png');

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
