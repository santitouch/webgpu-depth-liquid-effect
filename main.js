// Project: WebGPU Scanning Effect with Depth Map + Liquid Distortion
// Requirements: An image and its depth map
// Based on: https://github.com/d3adrabbit/ScanningEffectWithDepthMap

import { mat4 } from 'gl-matrix';
import vertexShaderWGSL from './shaders/vertex.wgsl';
import fragmentShaderWGSL from './shaders/fragment.wgsl';

const canvas = document.querySelector('#webgpu-canvas');
const mouse = { x: 0, y: 0, inside: false };
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) / rect.width;
  mouse.y = (e.clientY - rect.top) / rect.height;
});
canvas.addEventListener('mouseenter', () => mouse.inside = true);
canvas.addEventListener('mouseleave', () => mouse.inside = false);

async function initWebGPU() {
  if (!navigator.gpu) throw new Error('WebGPU not supported.');
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const img = await loadTexture(device, './assets/image.jpg');
  const depthMap = await loadTexture(device, './assets/depth.jpg');

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({ code: vertexShaderWGSL }),
      entryPoint: 'main',
    },
    fragment: {
      module: device.createShaderModule({ code: fragmentShaderWGSL }),
      entryPoint: 'main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const uniformBuffer = device.createBuffer({
    size: 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: img.createView() },
      { binding: 2, resource: depthMap.createView() },
      { binding: 3, resource: { buffer: uniformBuffer } },
    ],
  });

  function render() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    const mouseData = new Float32Array([
      mouse.x, mouse.y, mouse.inside ? 1.0 : 0.0, performance.now() / 1000.0,
    ]);
    device.queue.writeBuffer(uniformBuffer, 0, mouseData.buffer);

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, 1, 0, 0);
    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
  }

  render();
}

async function loadTexture(device, url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const bitmap = await createImageBitmap(img);
  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture: texture },
    [bitmap.width, bitmap.height]
  );
  return texture;
}

initWebGPU();
