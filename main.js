// WebGPU Depth Visual Effect with Elegant Reflective Wavy Lines and Responsive Canvas

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
  let gold = vec3<f32>(1.0, 0.843, 0.0);
  let silver = vec3<f32>(0.75, 0.75, 0.75);
  return mix(gold, silver, 0.5 + 0.5 * sin(t * 2.0));
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let time = mouseData.w;
    let mouse = mouseData.xy;
    let isHovering = mouseData.z;

    var distUV = uv;
    if (isHovering > 0.5) {
        let distToMouse = distance(uv, mouse);
        let ripple = sin(distToMouse * 40.0 - time * 4.0) * exp(-distToMouse * 5.0);
        let distortion = normalize(uv - mouse) * ripple * 0.005;
        distUV = uv + distortion;
    }

    let baseColorSample = textureSample(img, sampler0, distUV);
    let depth = textureSample(depthMap, sampler0, distUV).r;

    let tilt = smoothstep(0.2, 0.8, depth);
    let blur = tilt * 0.008;
    let blurColor = textureSample(img, sampler0, distUV + vec2<f32>(0.0, blur)) * 0.5 + textureSample(img, sampler0, distUV - vec2<f32>(0.0, blur)) * 0.5;
    let finalColor = mix(baseColorSample, blurColor, tilt);

    var lines = vec3<f32>(0.0);
    if (isHovering > 0.5) {
        let distToMouse = distance(distUV, mouse);
        let fade = smoothstep(0.9, 1.0, depth);
        let mask = smoothstep(0.25, 0.0, distToMouse);
        let gridUV = distUV * vec2(120.0, 6.0);
        let wave = sin(gridUV.x + time * 2.0);
        let lineStrength = smoothstep(0.48, 0.52, fract(gridUV.y + wave));
        let rand = hash(floor(gridUV));
        let color = palette(time + rand * 10.0);
        lines = color * lineStrength * fade * mask * 1.5;
    }

    return vec4<f32>(finalColor.rgb + lines, 1.0);
}`;

// Responsive canvas setup
const canvas = document.querySelector("canvas");
function resizeCanvas() {
    const aspect = 2464 / 1856; // your image aspect ratio
    const width = window.innerWidth;
    const height = window.innerHeight;
    const canvasAspect = width / height;

    if (canvasAspect > aspect) {
        canvas.height = height * window.devicePixelRatio;
        canvas.width = height * aspect * window.devicePixelRatio;
    } else {
        canvas.width = width * window.devicePixelRatio;
        canvas.height = width / aspect * window.devicePixelRatio;
    }

    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.display = "block";
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// WebGPU Depth Visual Effect with Reflective Wavy Lines and Responsive Canvas

const vertexShaderWGSL = `...`; // Keep this from the Canvas version above
const fragmentShaderWGSL = `...`; // Keep this from the Canvas version above

// === Responsive canvas setup ===
const canvas = document.querySelector("canvas");

function resizeCanvas() {
    const aspect = 2464 / 1856;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const canvasAspect = width / height;

    if (canvasAspect > aspect) {
        canvas.height = height * window.devicePixelRatio;
        canvas.width = height * aspect * window.devicePixelRatio;
    } else {
        canvas.width = width * window.devicePixelRatio;
        canvas.height = width / aspect * window.devicePixelRatio;
    }

    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.display = "block";
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// === Image Loader ===
async function loadImageBitmap(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return await createImageBitmap(blob);
}

// === WebGPU Init ===
async function init() {
    if (!navigator.gpu) throw new Error("WebGPU not supported.");

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device,
        format,
        alphaMode: "opaque"
    });

    // Load image & depth map
    const [imageBitmap, depthBitmap] = await Promise.all([
        loadImageBitmap("assets/image2.jpg"),
        loadImageBitmap("assets/depth2.jpg")
    ]);

    const imgTex = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: imgTex }, [imageBitmap.width, imageBitmap.height]);

    const depthTex = device.createTexture({
        size: [depthBitmap.width, depthBitmap.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture({ source: depthBitmap }, { texture: depthTex }, [depthBitmap.width, depthBitmap.height]);

    const sampler = device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
    });

    const mouseBuffer = device.createBuffer({
        size: 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

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
            entryPoint: "main"
        },
        fragment: {
            module: device.createShaderModule({ code: fragmentShaderWGSL }),
            entryPoint: "main",
            targets: [{ format }],
        },
        primitive: { topology: "triangle-list" }
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

    // === Mouse tracking ===
    let mouse = [0, 0, 0];
    canvas.addEventListener("mouseenter", () => (mouse[2] = 1));
    canvas.addEventListener("mouseleave", () => (mouse[2] = 0));
    canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse[0] = (e.clientX - rect.left) / rect.width;
        mouse[1] = (e.clientY - rect.top) / rect.height;
    });

    // === Frame loop ===
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

init();
