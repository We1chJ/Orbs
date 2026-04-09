uniform float uDeltaTime;
uniform sampler2D uSourceParticlesTexture;
uniform sampler2D uTargetParticlesTexture;
uniform vec2 uTargetNestedCenter;
uniform float uTargetNestedScale;
uniform float uSpeedMin;
uniform float uSpeedMax;
uniform float uStartRadiusRatio;
uniform float uEndRadiusRatio;
uniform float uNeckRadiusRatio;
uniform float uPinchSharpness;
uniform float uRadialShellMin;
uniform float uLifetimeScaleMin;
uniform float uLifetimeScaleMax;
uniform bool uInitialize;

const float TAU = 6.28318530718;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void buildOrthonormalBasis(vec3 dir, out vec3 tangentA, out vec3 tangentB) {
    vec3 helper = abs(dir.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    tangentA = normalize(cross(dir, helper));
    tangentB = normalize(cross(tangentA, dir));
}

float hourglassRadius(float t, float startRadius, float endRadius, float neckRadius) {
    // Quadratic profile: high at t=0/1, low at t=0.5
    float edgeProfile = clamp(4.0 * (t - 0.5) * (t - 0.5), 0.0, 1.0);
    // Power < 1 widens the ends faster so the pinch reads more clearly.
    edgeProfile = pow(edgeProfile, max(0.05, uPinchSharpness));
    float edgeRadius = mix(startRadius, endRadius, t);
    return mix(neckRadius, edgeRadius, edgeProfile);
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    // Packed UV seeds selecting one source particle and one destination particle.
    vec4 seedData = texture2D(uStreamVelocity, uv);
    vec2 sourceSampleUv = seedData.xy;
    vec2 targetSampleUv = seedData.zw;
    float speedSeed = hash12(sourceSampleUv * 37.0 + targetSampleUv * 17.0);
    float phaseSeed = hash12(sourceSampleUv * 59.0 + targetSampleUv * 13.0 + 0.17);
    float radialSeed = hash12(sourceSampleUv * 23.0 + targetSampleUv * 41.0 + 0.51);
    float lifetimeSeed = hash12(sourceSampleUv * 11.0 + targetSampleUv * 73.0 + 0.93);

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
    float lifetimeScale = mix(uLifetimeScaleMin, uLifetimeScaleMax, lifetimeSeed);

    float travelProgress;
    bool reachedDestination = false;

    if (uInitialize) {
        travelProgress = hash12(uv + sourceSampleUv * 11.0 + targetSampleUv * 7.0);
    } else {
        float nextProgress = progress + ((speed * uDeltaTime) / pathLength) / lifetimeScale;
        reachedDestination = nextProgress >= 1.0;
        travelProgress = min(nextProgress, 1.0);
    }

    float startRadius = max(1e-4, pathLength * uStartRadiusRatio);
    float endRadius = max(1e-4, pathLength * uEndRadiusRatio);
    float neckRadius = max(1e-4, pathLength * uNeckRadiusRatio);
    float radius = hourglassRadius(travelProgress, startRadius, endRadius, neckRadius);
    // Anchor to both orb surfaces so the bridge starts on the big orb and
    // collapses into the target small orb instead of staying wide at the end.
    float startAnchor = smoothstep(0.0, 0.06, travelProgress);
    float endAnchor = 1.0 - smoothstep(0.68, 1.0, travelProgress);
    radius *= startAnchor * endAnchor;

    float shellBias = pow(radialSeed, 0.22);
    float radialWeight = mix(uRadialShellMin, 1.0, shellBias);
    float swirlAngle = phaseSeed * TAU;
    vec3 swirlDir = cos(swirlAngle) * tangentA + sin(swirlAngle) * tangentB;

    vec3 centerLinePos = mix(sourcePos, targetPos, travelProgress);
    vec3 nextPos = centerLinePos + swirlDir * (radius * radialWeight);
    float storedProgress = reachedDestination ? 0.0 : travelProgress;
    gl_FragColor = vec4(nextPos, storedProgress);
}
