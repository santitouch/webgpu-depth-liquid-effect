// WebGPU Depth Visual Effect with HAUTE COUTURE click+hold grow + wave animation (no glow + eased scaling)

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
        vec2(-1.0,  1.0), vec2( 1.0, -1.0), vec2(1.0,  1.0)
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

// Fragment shader
const fragmentShaderWGSL = `
@group(0) @binding(0) var sampler0 : sampler;
@group(0) @binding(1) var img : texture_2d<f32>;
@group(0) @binding(2) var depthMap : texture_2d<f32>;
@group(0) @binding(3) var hauteTex : texture_2d<f32>;
@group(0) @binding(4) var<uniform> mouseData : vec4<f32>; // x, y, inside, time
@group(0) @binding(5) var<uniform> pressState : f32;      // click and hold state

fn inRegion(uv: vec2<f32>, center: vec2<f32>, size: vec2<f32>) -> bool {
    let halfSize = size * 0.5;
    return all(uv >= center - halfSize) && all(uv <= center + halfSize);
}

fn easeInOutQuad(t: f32) -> f32 {
    return select(2.0 * t * t, 1.0 - pow(-2.0 * t + 2.0, 2.0) / 2.0, t >= 0.5);
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let time = mouseData.w;
    let mouse = mouseData.xy;
    let isHovering = mouseData.z;

    let baseColor = textureSample(img, sampler0, uv);

    // Ripple distortion effect
    var uvDistorted = uv;
    if (isHovering > 0.5) {
        let dist = distance(mouse, uv);
        let ripple = 0.005 * sin(40.0 * dist - time * 4.0);
        uvDistorted += normalize(uv - mouse) * ripple * smoothstep(0.15, 0.0, dist);
    }

    let distortedColor = textureSample(img, sampler0, uvDistorted);
    let depth = textureSample(depthMap, sampler0, uv).r;

    var hauteColor = vec3<f32>(0.0);

    // Apply easing over time in main.js and pass final scale as pressState
    let scale = mix(1.0, 1.5, pressState);
    let texSize = scale * vec2<f32>(500.0 / 2464.0, 500.0 / 1856.0);

    let waveOffset = vec2<f32>(
        sin((uv.y + time * 0.2) * 4.0) * 0.005,
        cos((uv.x + time * 0.2) * 4.0) * 0.005
    ) * pressState;

    let offset = waveOffset;
    let localUV = (uv - (mouse - texSize * 0.5 + offset)) / texSize;
    let hauteSample = textureSample(hauteTex, sampler0, localUV).r;

    let showHaute = isHovering > 0.5 && inRegion(uv, mouse, texSize) && depth > 0.5;
    hauteColor = select(vec3<f32>(0.0), vec3<f32>(hauteSample), showHaute);

    return vec4<f32>(distortedColor.rgb + hauteColor, 1.0);
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
        loadImageBitmap("assets/image.png"),
        loadImageBitmap("assets/depth.png"),
        loadImageBitmap("assets/haute-texture2.png")
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
    const pressStateBuffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
            { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
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
            { binding: 5, resource: { buffer: pressStateBuffer } },
        ]
    });

    let mouse = [0, 0, 0];
    let mousePressed = false;

    canvas.addEventListener("mouseenter", () => (mouse[2] = 1));
    canvas.addEventListener("mouseleave", () => (mouse[2] = 0));
    canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse[0] = (e.clientX - rect.left) / rect.width;
        mouse[1] = (e.clientY - rect.top) / rect.height;
    });
    canvas.addEventListener("mousedown", () => (mousePressed = true));
    canvas.addEventListener("mouseup", () => (mousePressed = false));

    function frame(time) {
        const seconds = time * 0.001;
        device.queue.writeBuffer(mouseBuffer, 0, new Float32Array([mouse[0], mouse[1], mouse[2], seconds]));
        device.queue.writeBuffer(pressStateBuffer, 0, new Float32Array([mousePressed ? 1.0 : 0.0]));

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
