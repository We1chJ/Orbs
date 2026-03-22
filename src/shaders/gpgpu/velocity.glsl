uniform float uTime;
uniform float uSpeed;
uniform float uCurlFreq;
uniform float uDeltaTime;
uniform float uAttraction;
uniform float uDamping;
uniform float uSpinSpeed;
uniform float uWindowResponseMin;
uniform float uWindowResponseMax;
uniform vec3 uWindowForce;
uniform sampler2D uBase;

#include "lygia/generative/curl.glsl"
#include "lygia/generative/snoise.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    vec3 basePos = texture2D(uBase, uv).rgb;
    vec3 currentPos = texture2D(uParticles, uv).rgb;
    vec4 currentVelData = texture2D(uVelocity, uv);
    vec3 currentVel = currentVelData.rgb;
    float randomDelaySeed = currentVelData.a;

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

    float angle = uTime * uSpinSpeed;
    float s = sin(angle);
    float c = cos(angle);
    mat2 rot = mat2(c, s, -s, c);
    // Rotate on the XZ plane (spinning around the Y axis)
    idealPos.xz *= rot;

    vec3 toTarget = idealPos - currentPos;
    vec3 targetVel = (currentVel + (toTarget * uAttraction - uWindowForce) * uDeltaTime) * uDamping;

    // Each particle gets its own response time from the random alpha seed.
    float responseSeconds = mix(uWindowResponseMin, uWindowResponseMax, randomDelaySeed);
    float responseAlpha = 1.0 - exp(-uDeltaTime / max(responseSeconds, 0.0001));
    vec3 nextVel = mix(currentVel, targetVel, responseAlpha);

    // Preserve alpha so the per-particle delay seed remains stable across frames.
    gl_FragColor = vec4(nextVel, randomDelaySeed);
}
