uniform vec3 uColor;
uniform float uOpacity;

varying float vProgress;

void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;

    float radial = smoothstep(1.0, 0.0, r2);
    float fadeIn = smoothstep(0.0, 0.08, vProgress);
    float fadeOut = 1.0 - smoothstep(0.90, 1.0, vProgress);
    float alpha = radial * fadeIn * fadeOut * uOpacity;

    gl_FragColor = vec4(uColor, alpha);
}
