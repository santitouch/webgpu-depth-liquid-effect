// fragment.wgsl

@group(0) @binding(0) var sampler0 : sampler;
@group(0) @binding(1) var img : texture_2d<f32>;
@group(0) @binding(2) var depthMap : texture_2d<f32>;
@group(0) @binding(3) var<uniform> mouseData : vec4<f32>; // x, y, inside, time

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let mousePos = mouseData.xy;
    let isInside = mouseData.z;
    let time = mouseData.w;

    // Distance from mouse to current pixel
    let dist = distance(uv, mousePos);

    // Get depth and use it for a parallax effect
    let depth = textureSample(depthMap, sampler0, uv).r;
    let depthOffset = (depth - 0.5) * 0.05;

    // Scanning ring (subtle pulse)
    var scan = 0.0;
    if (isInside > 0.5) {
        let ringRadius = 0.2 + 0.03 * sin(time * 6.0);
        let fade = smoothstep(ringRadius + 0.02, ringRadius - 0.02, dist);
        scan = fade;
    }

    // Liquid distortion effect on hover near mouse
    var distortedUV = uv;
    if (isInside > 0.5) {
        let wave = 0.01 * sin(50.0 * dist - time * 10.0);
        let direction = normalize(uv - mousePos + vec2(0.001));
        distortedUV += direction * wave * (0.2 - dist);
    }

    // Offset by depth (parallax)
    distortedUV += vec2(depthOffset);

    // Sample base color with final UV
    let color = textureSample(img, sampler0, distortedUV);

    // Add scanning highlight on top
    let finalColor = mix(color, vec4(1.0, 1.0, 1.0, 1.0), scan * 0.4);

    return finalColor;
}

