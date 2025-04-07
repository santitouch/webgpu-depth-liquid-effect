// WebGPU Depth Visual Effect with Repeated "HAUTE COUTURE" Texture, Mouse Distortion & Responsive Canvas

// Vertex shader: outputs UV coordinates and positions for a full-screen quad
const vertexShaderWGSL = `
struct VertexOutput {
    @builtin(position) Position : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
    var pos = array<vec2<f32>, 6>(
        vec2(-1.0, -1.0), vec2( 1.0, -1.0), vec2(-1.0,  1.0),
        vec2(-1.0,  1.0), vec2( 1.0, -1.0), vec2( 1.0,  1.0)
    );
    var uv = array<vec2<f32>, 6>(
        vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(0.0, 0.0),
        vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(1.0, 0.0)
    );
    var output : VertexOutput;
    output.Position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
    output.uv = uv[vertexIndex];
    return output;
}`;

// Fragment shader: samples image, depth and haute-texture, applies ripple & pattern
const fragmentShaderWGSL = `
@group(0) @binding(0) var sampler0 : sampler;
@group(0) @binding(1) var img : texture_2d<f32>;
@group(0) @binding(2) var depthMap : texture_2d<f32>;
@group(0) @binding(3) var hauteTex : texture_2d<f32>;
@group(0) @binding(4) var<uniform> mouseData : vec4<f32>; // x, y, inside, time

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let time = mouseData.w;
    let mouse = mouseData.xy;
    let isHovering = mouseData.z;

    let depth = textureSample(depthMap, sampler0, uv).r;

    // Ripple distortion effect when hovering
    var uvDistorted = uv;
    if (isHovering > 0.5) {
        let dist = distance(mouse, uv);
        let ripple = 0.005 * sin(40.0 * dist - time * 4.0);
        uvDistorted += normalize(uv - mouse) * ripple * smoothstep(0.15, 0.0, dist);
    }

    let baseColor = textureSample(img, sampler0, uvDistorted);

    // Sample haute texture outside control flow to satisfy uniformity
    let repeatUV = fract(uv * vec2<f32>(4.0, 4.0));
    let hauteColor = textureSample(hauteTex, sampler0, repeatUV);

    var textEffect = vec3<f32>(0.0);
    if (isHovering > 0.5 && depth > 0.5) {
        textEffect = hauteColor.rgb * 1.2;
    }

    return vec4<f32>(baseColor.rgb + textEffect, 1.0);
}`;

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
    canvas.style.margin = "0 auto";
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

async function loadImageBitmap(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return await createImageBitmap(blob);
}

async function init() {
    if (!navigator.gpu) throw new Error("WebGPU not supported.");

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({ device, format, alphaMode: "opaque" });

    const [imageBitmap, depthBitmap, hauteBitmap] = await Promise.all([
        loadImageBitmap("assets/image2.jpg"),
        loadImageBitmap("assets/depth2.jpg"),
        loadImageBitmap("assets/haute-texture.png")
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

    const hauteTex = device.createTexture({
        size: [hauteBitmap.width, hauteBitmap.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture({ source: hauteBitmap }, { texture: hauteTex }, [hauteBitmap.width, hauteBitmap.height]);

    const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    const mouseBuffer = device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
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
            { binding: 3, resource: hauteTex.createView() },
            { binding: 4, resource: { buffer: mouseBuffer } },
        ]
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
            }]
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
