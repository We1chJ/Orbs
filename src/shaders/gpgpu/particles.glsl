uniform float uTime;
uniform float uSpeed;
uniform float uCurlFreq;
uniform float uDeltaTime;
uniform sampler2D uBase;

#include "lygia/generative/curl.glsl"
#include "lygia/generative/snoise.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    
    // Read the static BASE position
    vec3 basePos = texture2D(uBase, uv).rgb;
    
    // Time value
    float t = uTime * uSpeed * 0.015;
    
    // Start both from basePos
    vec3 pos = basePos;
    vec3 curlPos = basePos;
    
    // Apply curl transformations
    pos = curl(pos * uCurlFreq + t);
    curlPos = curl(curlPos * uCurlFreq + t);
    curlPos += curl(curlPos * uCurlFreq * 2.0) * 0.5;
    curlPos += curl(curlPos * uCurlFreq * 4.0) * 0.25;
    curlPos += curl(curlPos * uCurlFreq * 8.0) * 0.125;
    curlPos += curl(pos * uCurlFreq * 16.0) * 0.0625;
    
    // Mix with noise
    gl_FragColor = vec4(mix(pos, curlPos, snoise(pos + t)), 1.0);
}
