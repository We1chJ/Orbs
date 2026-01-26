uniform sampler2D uParticlesTexture;
uniform float uTime;
uniform float uFocus;
uniform float uFov;
uniform float uBlur;
uniform vec3 uColor;
varying float vDistance;
varying vec3 vColor;
attribute vec2 aParticlesUv;

void main() { 
    vec3 pos = texture2D(uParticlesTexture, aParticlesUv.xy).xyz;
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vDistance = abs(uFocus - -mvPosition.z);
    gl_PointSize = (step(1.0 - (1.0 / uFov), aParticlesUv.x)) * vDistance * uBlur * 2.0;

    vColor = uColor;
}