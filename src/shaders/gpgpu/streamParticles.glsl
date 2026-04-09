uniform float uTime;
uniform float uDeltaTime;
uniform sampler2D uSourceParticlesTexture;
uniform sampler2D uTargetParticlesTexture;
uniform vec2 uTargetNestedCenter;
uniform float uTargetNestedScale;
uniform float uSpeedMin;
uniform float uSpeedMax;
uniform float uNoiseAmplitude;
uniform float uNoiseFrequency;
uniform bool uInitialize;

void buildOrthonormalBasis(vec3 dir, out vec3 tangentA, out vec3 tangentB) {
    vec3 helper = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    tangentA = normalize(cross(dir, helper));
    tangentB = normalize(cross(tangentA, dir));
}

#include "lygia/generative/snoise.glsl"

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

const float PI = 3.14159265359;

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    // Packed UV seeds selecting one source particle and one destination particle.
    vec4 seedData = texture2D(uStreamVelocity, uv);
    vec2 sourceSampleUv = seedData.xy;
    vec2 targetSampleUv = seedData.zw;
    float speedSeed = hash12(sourceSampleUv * 37.0 + targetSampleUv * 17.0);

    vec4 currentParticle = texture2D(uStreamParticles, uv);
    float progress = currentParticle.w;

    // Start points are sampled from the source big-orb particles.
    vec3 sourcePos = texture2D(uSourceParticlesTexture, sourceSampleUv).xyz;

    // End points are sampled from the target orb particles and transformed
    // into the target nested/small orb surface space.
    vec3 targetBigPos = texture2D(uTargetParticlesTexture, targetSampleUv).xyz;
    vec3 targetCenter = vec3(uTargetNestedCenter, 0.0);
    vec3 targetPos = targetCenter + (targetBigPos - targetCenter) * uTargetNestedScale;

    vec3 path = targetPos - sourcePos;
    float pathLength = max(length(path), 1e-4);
    vec3 pathDir = path / pathLength;

    vec3 tangentA;
    vec3 tangentB;
    buildOrthonormalBasis(pathDir, tangentA, tangentB);

    float speed = mix(uSpeedMin, uSpeedMax, speedSeed);

    float travelProgress;
    bool reachedDestination = false;

    if (uInitialize) {
        travelProgress = hash12(uv + sourceSampleUv * 11.0 + targetSampleUv * 7.0);
    } else {
        float nextProgress = progress + (speed * uDeltaTime) / pathLength;
        reachedDestination = nextProgress >= 1.0;
        travelProgress = min(nextProgress, 1.0);
    }

    // Natural path wobble driven by procedural noise.
    // Envelope keeps noise at zero on both endpoints so each particle starts
    // and ends exactly on sampled surface points.
    float envelope = sin(travelProgress * PI);
    float t = uTime * uNoiseFrequency;
    float n1 = snoise(vec3(sourceSampleUv * 21.7 + travelProgress * 1.8, t + speedSeed * 3.1));
    float n2 = snoise(vec3(targetSampleUv * 19.3 + travelProgress * 2.3, t + speedSeed * 5.7));
    vec3 noiseOffset = (tangentA * n1 + tangentB * n2) * (uNoiseAmplitude * envelope);

    vec3 nextPos = mix(sourcePos, targetPos, travelProgress) + noiseOffset;
    float storedProgress = reachedDestination ? 0.0 : travelProgress;
    gl_FragColor = vec4(nextPos, storedProgress);
}
