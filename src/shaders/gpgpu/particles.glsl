uniform float uTime;
uniform float uSpeed;
uniform float uCurlFreq;
uniform float uDeltaTime;
uniform sampler2D uBase;

#include "lygia/generative/curl.glsl"
#include "lygia/generative/snoise.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    
    // Read CURRENT position (from feedback loop)
    vec3 currentPos = texture2D(uParticles, uv).rgb;
    
    // Read BASE position (static sphere - like the original 'positions' texture)
    vec3 basePos = texture2D(uBase, uv).rgb;
    
    // Time scaling (match original)
    float t = uTime * 0.015;
    
    // EXACT replica of original logic, but using basePos instead of reading positions
    vec3 pos = curl(basePos * uCurlFreq + t);
    
    vec3 curlPos = curl(basePos * uCurlFreq + t);
    curlPos += curl(curlPos * uCurlFreq * 2.0) * 0.5;
    curlPos += curl(curlPos * uCurlFreq * 4.0) * 0.25;
    curlPos += curl(curlPos * uCurlFreq * 8.0) * 0.125;
    curlPos += curl(pos * uCurlFreq * 16.0) * 0.0625;
    
    // Mix between the two curl outputs with noise (exact original logic)
    float noiseVal = snoise(vec3(basePos + t));
    vec3 targetPos = mix(pos, curlPos, noiseVal);
    
    // Smoothly interpolate from current position to target
    // This creates the smooth flowing motion
    vec3 newPos = mix(currentPos, targetPos, uSpeed); // Adjust 0.08 for speed (0.05-0.15 works well)
    
    gl_FragColor = vec4(newPos, 1.0);
}