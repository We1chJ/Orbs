uniform float uTime;
uniform float uDeltaTime;
uniform sampler2D uBase;

#include "lygia/generative/curl.glsl"
#include "lygia/generative/snoise.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    vec4 particle = texture(uParticles, uv);
    vec4 base = texture(uBase, uv);

    if (particle.a >= 1.0) {
        particle.a = mod(particle.a, 1.0);
        particle.xyz = base.xyz;
    }
    else {
        vec3 pos = particle.xyz;

        float scale = 0.5;
        float speed = 0.5;
        float strength = 0.1;

        vec3 curlNoise = vec3(0.0);
        float amp = 1.0;
        float freq = scale;

        for (int i = 0; i < 3; i++) {
            curlNoise += curl(pos * freq + uTime * speed) * amp;
            amp *= 0.5;
            freq *= 2.0;
        }

        curlNoise = normalize(curlNoise) * strength;

        particle.xyz += curlNoise * uDeltaTime * 2.0;

        particle.a += uDeltaTime * 0.15;
    }

    gl_FragColor = particle;
}