// WebGPU Depth Visual Effect with Wavy Lines and Responsive Canvas

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
        vec2(0.0, 0.0),
        vec2(1.0, 0.0),
        vec2(0.0, 1.0),
        vec2(0.0, 1.0),
        vec2(1.0, 0.0),
        vec2(1.0, 1.0)
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
  return mix(vec3<f32>(1.0, 0.0, 0.6), vec3<f32>(0.0, 0.0, 0.8), 0.5 + 0.5 * sin(t * 3.0));
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let time = mouseData.w;
    let mouse = mouseData.xy;
    let isHovering = mouseData.z;
    let depth = textureSample(depthMap, sampler0, uv).r;

    var distUV = uv;
    if (isHovering > 0.5) {
        let distToMouse = distance(uv, mouse);
        let ripple = sin(distToMouse * 60.0 - time * 8.0) * exp(-distToMouse * 10.0);
        let distortion = normalize(uv - mouse) * ripple * 0.01;
        distUV = uv + distortion;
    }

    let baseColor = textureSample(img, sampler0, distUV);

    // Tilt-shift based on depth
    let tilt = smoothstep(0.2, 0.8, depth);
    let blur = tilt * 0.008;
    let blurColor = textureSample(img, sampler0, uv + vec2<f32>(0.0, blur)) * 0.5 + textureSample(img, sampler0, uv - vec2<f32>(0.0, blur)) * 0.5;
    let finalBase = mix(baseColor, blurColor, tilt);

    // Animated wavy lines on bright areas
    var lines = vec3<f32>(0.0);
    if (isHovering > 0.5) {
        let distToMouse = distance(uv, mouse);
        let fade = smoothstep(1.0, 0.6, depth);
        let mask = smoothstep(0.25, 0.0, distToMouse);
        let gridUV = uv * vec2(400.0, 400.0);
        let wave = sin(gridUV.x * 2.0 + time * 5.0) * 0.3;
        let lineStrength = smoothstep(0.49, 0.51, fract(gridUV.y + wave));
        let rand = hash(floor(gridUV));
        let color = palette(time + rand * 20.0);
        lines = color * lineStrength * fade * mask * 0.6;
    }

    return vec4<f32>(finalBase.rgb + lines, 1.0);
}`;

const canvas = document.getElementById('webgpu-canvas');
const mouseData = new Float32Array(4); // x, y, isHovering, time

let imgBitmap, depthBitmap;
const imageWidth = 2464;
const imageHeight = 1856;

async function loadImageBitmap(src) {
  const res = await fetch(src);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

async function init() {
  if (!navigator.gpu) throw new Error('WebGPU not supported.');
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');

  const scale = Math.min(window.innerWidth / imageWidth, window.innerHeight / imageHeight);
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = imageWidth * scale * pixelRatio;
  canvas.height = imageHeight * scale * pixelRatio;
  canvas.style.width = `${imageWidth * scale}px`;
  canvas.style.height = `${imageHeight * scale}px`;

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  imgBitmap = await loadImageBitmap('./image.png');
  depthBitmap = await loadImageBitmap('./depth.png');

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const imgTex = device.createTexture({
    size: [imgBitmap.width, imgBitmap.height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: imgBitmap }, { texture: imgTex }, [imgBitmap.width, imgBitmap.height]);

  const depthTex = device.createTexture({
    size: [depthBitmap.width, depthBitmap.height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: depthBitmap }, { texture: depthTex }, [depthBitmap.width, depthBitmap.height]);

  const mouseBuffer = device.createBuffer({
    size: mouseData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module: device.createShaderModule({ code: vertexShaderWGSL }), entryPoint: 'main' },
    fragment: {
      module: device.createShaderModule({ code: fragmentShaderWGSL }),
      entryPoint: 'main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: imgTex.createView() },
      { binding: 2, resource: depthTex.createView() },
      { binding: 3, resource: { buffer: mouseBuffer } },
    ],
  });

  function updateMouse(ev) {
    const rect = canvas.getBoundingClientRect();
    mouseData[0] = (ev.clientX - rect.left) / rect.width;
    mouseData[1] = (ev.clientY - rect.top) / rect.height;
    mouseData[2] = 1.0;
  }

  canvas.addEventListener('mousemove', updateMouse);
  canvas.addEventListener('mouseleave', () => (mouseData[2] = 0));

  const render = (time) => {
    mouseData[3] = time * 0.001;
    device.queue.writeBuffer(mouseBuffer, 0, mouseData.buffer);

    const encoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: textureView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
  };

  requestAnimationFrame(render);
}

init();
