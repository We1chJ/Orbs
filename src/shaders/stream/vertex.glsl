uniform sampler2D uParticlesTexture;
uniform vec2 uResolution;
uniform float uPointSize;

attribute vec2 aParticlesUv;

varying float vProgress;

void main() {
    vec4 particleData = texture2D(uParticlesTexture, aParticlesUv);
    vec3 position = particleData.xyz;
    vProgress = particleData.w;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float depthScale = 1.0 / max(0.25, -mvPosition.z);
    gl_PointSize = uPointSize * depthScale * (uResolution.y / 900.0);
}
