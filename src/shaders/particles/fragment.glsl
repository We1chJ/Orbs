uniform float uOpacity;
varying float vDistance;
varying vec3 vColor;
void main() {
    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
    if (dot(cxy, cxy) > 1.0) discard;
    gl_FragColor = vec4(vColor, (1.04 - clamp(vDistance * 1.5, 0.0, 1.0)));
}   