// main.js

// Vertex shader (WGSL)
const vertexShaderWGSL = `
  @vertex
  fn main(@builtin(vertex_index) VertexIndex: u32) -> @builtin(position) vec4f {
    var pos = array<vec2f, 6>(
      vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
      vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    return vec4f(pos[VertexIndex], 0.0, 1.0);
  }
`;

// Fragment shader (WGSL)
const fragmentShaderWGSL = `
  struct Uniforms {
    mouse : vec2f,
    mouseActive : f32,
    time : f32,
  };

  @group(0) @binding(0) var sampler0: sampler;
  @group(0) @binding(1) var img: texture_2d<f32>;
  @group(0) @binding(2) var depth: texture_2d<f32>;
  @group(0) @binding(3) var<uniform> uniforms: Uniforms;

  fn rand(uv: vec2f) -> f32 {
    return fract(sin(dot(uv, vec2f(12.9898, 78.233))) * 43758.5453);
  }

  fn circleMask(uv: vec2f, center: vec2f, radius: f32) -> f32 {
    let dist = distance(uv, center);
    return smoothstep(radius, radius - 0.2, dist);
  }

  @fragment
  fn main(@builtin(position) coord: vec4f) -> @location(0) vec4f {
    let uv = coord.xy / vec2f(textureDimensions(img));
    let base = textureSample(img, sampler0, uv);
    let depthVal = textureSample(depth, sampler0, uv).r;

    // Liquid ripple distortion
    var ripple = vec2f(0.0);
    if (uniforms.mouseActive > 0.0) {
      let d = distance(uv, uniforms.mouse);
      let rippleStrength = 0.005;
      ripple = normalize(uv - uniforms.mouse) * sin((d - uniforms.time) * 20.0) * rippleStrength / (1.0 + d * 40.0);
    }

    let displacedUV = clamp(uv + ripple, vec2f(0.0), vec2f(1.0));
    let color = textureSample(img, sampler0, displacedUV);

    // Particle shimmer effect on bright areas
    let brightness = textureSample(depth, sampler0, uv).r;
    let mask = circleMask(uv, uniforms.mouse, 0.3);
    let showParticles = step(0.6, brightness) * mask * uniforms.mouseActive;

    let sparkle = rand(uv * uniforms.time * 2.0);
    let pulse = abs(sin(uniforms.time * 4.0 + sparkle * 10.0));

    let shimmer = vec3f(1.0, 0.8, 0.2) * pulse;
    let shimmerAlpha = pulse * 0.3 * showParticles;

    return vec4f(color.rgb + shimmer * shimmerAlpha, 1.0);
  }
`;

// Load images as ImageBitmap
async function loadImageBitmap(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

// Initialize everything
async function init() {
  const canvas = document.querySelector("canvas");
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    context.configure({
      device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "opaque",
    });
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  const [imageBitmap, depthBitmap] = await Promise.all([
    loadImageBitmap("assets/image2.jpg"),
    loadImageBitmap("assets/depth2.jpg")
  ]);

  const imgTex = device.createTexture({
    size: [imageBitmap.width, imageBitmap.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const depthTex = device.createTexture({
    size: [depthBitmap.width, depthBitmap.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: imgTex }, [imageBitmap.width, imageBitmap.height]);
  device.queue.copyExternalImageToTexture({ source: depthBitmap }, { texture: depthTex }, [depthBitmap.width, depthBitmap.height]);

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const mouseBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: device.createShaderModule({ code: vertexShaderWGSL }),
      entryPoint: "main",
    },
    fragment: {
      module: device.createShaderModule({ code: fragmentShaderWGSL }),
      entryPoint: "main",
      targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
    },
    primitive: { topology: "triangle-list" },
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

  let mouse = [0, 0, 0];
  canvas.addEventListener("mouseenter", () => (mouse[2] = 1));
  canvas.addEventListener("mouseleave", () => (mouse[2] = 0));
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse[0] = (e.clientX - rect.left) / rect.width;
    mouse[1] = (e.clientY - rect.top) / rect.height;
  });

  function frame(time) {
    const seconds = time * 0.001;
    device.queue.writeBuffer(mouseBuffer, 0, new Float32Array([mouse[0], mouse[1], mouse[2], seconds]));

    const encoder = device.createCommandEncoder();
    const view = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// Start the app
init();
