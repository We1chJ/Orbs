uniform float uTime;
uniform float uSpeed;
uniform float uCurlFreq;
uniform float uDeltaTime;
uniform float uAttraction;
uniform float uDamping;
uniform float uSpinSpeed;
uniform float uWindowResponseMin;
uniform float uWindowResponseMax;
uniform float uAccelNoiseScale;
uniform vec2 uCameraCenterOffset;
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

    vec3 cameraShift = vec3(uCameraCenterOffset, 0.0);

    float t = uTime * uSpeed * 0.015;

    // --- 1. IDEAL POSITION ---
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
    idealPos.xz *= rot;

    vec3 shiftedIdealPos = idealPos + cameraShift;

    // --- 2. GRAVITY ONLY ---
    vec3 toTarget = shiftedIdealPos - currentPos;
    float distSq = dot(toTarget, toTarget);
    float softenedDistSq = distSq + 100.0;
    vec3 gravityAccel = normalize(toTarget + vec3(1e-6)) * (uAttraction / softenedDistSq);

    // --- 3. SUBTLE CURL VARIATION ON ACCELERATION ---
    // Feed current particle position into a curl field that slowly evolves with time.
    // This nudges each particle's acceleration slightly differently based on where it is,
    // giving organic variation without adding a separate driving force.
    // Kept very small (0.08) so gravity remains the dominant and only meaningful force.
    float cameraShiftMag = length(cameraShift);
    float hasCameraShift = step(1e-5, cameraShiftMag);
    vec3 cameraShiftDir = normalize(cameraShift + vec3(1e-6));
    vec3 cameraPushAccel = cameraShiftDir * cameraShiftMag * 10.0;
    vec3 accelNoise = curl(currentPos * 0.4 + t * 0.1) * uAccelNoiseScale;
    vec3 totalAccel = gravityAccel + (accelNoise + cameraPushAccel) * hasCameraShift;

    // --- 4. INTEGRATE ---
    vec3 targetVel = (currentVel + totalAccel * uDeltaTime) * uDamping;

    // --- 5. STAGGERED ACTIVATION ---
    float activated = step(randomDelaySeed * 3.0, uTime);

    float responseSeconds = mix(uWindowResponseMin, uWindowResponseMax, randomDelaySeed);
    float responseAlpha = 1.0 - exp(-uDeltaTime / max(responseSeconds, 0.0001));
    vec3 nextVel = mix(currentVel, targetVel * activated, responseAlpha);

    gl_FragColor = vec4(nextVel, randomDelaySeed);
}