const canvas = document.getElementById('webgpu-canvas');
const mouse = { x: 0.5, y: 0.5, inside: 0 };

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) / rect.width;
  mouse.y = (e.clientY - rect.top) / rect.height;
});

canvas.addEventListener('mouseenter', () => (mouse.inside = 1));
canvas.addEventListener('mouseleave', () => (mouse.inside = 0));

async function init() {
  if (!navigator.gpu) {
    throw new Error("WebGPU not supported.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque"
  });

  const imgTexture = await loadTexture(device, './assets/image.png');
  const depthTexture = await loadTexture(device, './assets/depth.png');

  const shaderModuleVS = device.createShaderModule({ code: vertexShaderWGSL });
  const shaderModuleFS = device.createShaderModule({ code: fragmentShaderWGSL });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModuleVS,
      entryPoint: "main",
    },
    fragment: {
      module: shaderModuleFS,
      entryPoint: "main",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

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
    const now = performance.now() / 1000;

    const mouseData = new Float32Array([mouse.x, mouse.y, mouse.inside, now]);
    device.queue.writeBuffer(uniformBuffer, 0, mouseData.buffer);

    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });

    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(6, 1, 0, 0);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
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
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    [bitmap.width, bitmap.height]
  );

  return texture;
}

init();
