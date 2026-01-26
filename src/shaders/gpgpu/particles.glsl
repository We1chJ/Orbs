uniform float uTime;
uniform float uSpeed;
uniform float uCurlFreq; 

#include "lygia/generative/curl.glsl"
#include "lygia/generative/snoise.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    // Get current position (exact same as example)
    vec3 pos = texture2D(uParticles, uv).rgb;

    // Exact same time scaling as the original example
    float t = uTime * 0.015 * uSpeed;

    // Base curl
    vec3 curlPos = curl(pos * uCurlFreq + t);

    // Exact multi-octave layers from the example
    curlPos += curl(curlPos * uCurlFreq * 2.0) * 0.5;
    curlPos += curl(curlPos * uCurlFreq * 4.0) * 0.25;
    curlPos += curl(curlPos * uCurlFreq * 8.0) * 0.125;
    curlPos += curl(pos * uCurlFreq * 16.0) * 0.0625;

    // Exact same blending with noise as the example
    float blend = snoise(pos + t);
    blend = (blend + 1.0) * 0.5;  // remap to [0,1]

    vec3 finalPos = mix(pos, curlPos, blend);

    gl_FragColor = vec4(finalPos, 1.0);
}