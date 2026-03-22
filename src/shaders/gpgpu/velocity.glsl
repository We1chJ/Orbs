uniform float uTime;
uniform float uSpeed;
uniform float uCurlFreq;
uniform float uDeltaTime;
uniform float uAttraction;
uniform float uDamping;
uniform float uSpinSpeed;
uniform vec2 uCameraCenterOffset;
uniform float uCenterPullScale;
uniform float uWindowResponseMin;
uniform float uWindowResponseMax;
uniform sampler2D uBase;

#include "lygia/generative/curl.glsl"
#include "lygia/generative/snoise.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    vec3 basePos = texture2D(uBase, uv).rgb;
    vec4 currentPosData = texture2D(uParticles, uv);
    vec3 currentPos = currentPosData.rgb;
    vec4 currentVelData = texture2D(uVelocity, uv);
    vec3 currentVel = currentVelData.rgb;
    float randomDelaySeed = currentVelData.a;

    // --- 1. LIQUID DEFORMATION MATH ---
    // Window force from camera movement
    vec3 uWindowForce = vec3(uCameraCenterOffset, 0.0) * uCenterPullScale;
    float forceStrength = length(uWindowForce);
    vec3 forceDir = normalize(uWindowForce + vec3(0.0001));
    
    // Stretch factor: 1.0 is a sphere, > 1.0 is an egg/pill shape
    float stretch = 1.2 + forceStrength * 0.2; 
    float squish = 1.0 / sqrt(max(stretch, 0.0001)); // Conserves volume

    // Deform the base coordinates
    vec3 deformedBase = basePos;
    float dotF = dot(deformedBase, forceDir);
    // Stretch along the movement axis, squish the others
    deformedBase += forceDir * dotF * (stretch - 1.0);
    deformedBase *= squish;

    float t = uTime * uSpeed * 0.015;
    vec3 pos = deformedBase;
    vec3 curlPos = deformedBase;

    pos = curl(pos * uCurlFreq + t);
    curlPos = curl(curlPos * uCurlFreq + t);
    curlPos += curl(curlPos * uCurlFreq * 2.0) * 0.5;
    curlPos += curl(curlPos * uCurlFreq * 4.0) * 0.25;
    vec3 idealPos = mix(pos, curlPos, snoise(pos + t));

    // Rotate the liquid blob
    float angle = uTime * uSpinSpeed;
    float s = sin(angle); 
    float c = cos(angle);
    mat2 rot = mat2(c, s, -s, c);
    idealPos.xz *= rot;

    // Apply camera offset to pull orb back to center
    vec3 deformedIdealPos = idealPos + uWindowForce;

    vec3 toTarget = deformedIdealPos - currentPos;
    
    // Window Force: The "Negative Pull" (sloshing inertia)
    // We multiply uWindowForce by a scalar to make the liquid "slosh"
    vec3 sloshForce = -uWindowForce * 5.0; 

    // Total Acceleration
    // Attract to the deformed ideal position + the window inertia
    vec3 acceleration = (toTarget * uAttraction) + sloshForce;

    // Standard Euler Integration
    vec3 targetVel = (currentVel + acceleration * uDeltaTime) * uDamping;

    // Apply the per-particle delay (response timing for organic feel)
    float responseSeconds = mix(uWindowResponseMin, uWindowResponseMax, randomDelaySeed);
    float responseAlpha = 1.0 - exp(-uDeltaTime / max(responseSeconds, 0.0001));
    vec3 nextVel = mix(currentVel, targetVel, responseAlpha);

    gl_FragColor = vec4(nextVel, randomDelaySeed);
}
