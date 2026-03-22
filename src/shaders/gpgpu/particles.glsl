uniform float uDeltaTime;
uniform float uTime;
uniform float uSpeed;
uniform float uCurlFreq;
uniform sampler2D uBase;
uniform bool uInitialize;

#include "lygia/generative/curl.glsl"
#include "lygia/generative/snoise.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    vec3 basePos = texture2D(uBase, uv).rgb;
    vec3 currentPos = texture2D(uParticles, uv).rgb;
    vec3 velocity = texture2D(uVelocity, uv).rgb;

    float t = uTime * uSpeed * 0.015;

    vec3 pos = basePos;
    vec3 curlPos = basePos;

    pos = curl(pos * uCurlFreq + t);
    curlPos = curl(curlPos * uCurlFreq + t);
    curlPos += curl(curlPos * uCurlFreq * 2.0) * 0.5;
    curlPos += curl(curlPos * uCurlFreq * 4.0) * 0.25;
    curlPos += curl(curlPos * uCurlFreq * 8.0) * 0.125;
    curlPos += curl(pos * uCurlFreq * 16.0) * 0.0625;

    vec3 idealPos = mix(pos, curlPos, snoise(pos + t));
    
    if(uInitialize) {
        gl_FragColor = vec4(idealPos, 1.0);
        return;
    }

    vec3 nextPos = currentPos + velocity * uDeltaTime;
    gl_FragColor = vec4(nextPos, 1.0);
}
