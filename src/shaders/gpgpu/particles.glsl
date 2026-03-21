uniform float uTime;
uniform float uSpeed;
uniform float uCurlFreq;
uniform float uDeltaTime;
uniform sampler2D uBase;
uniform bool uInitialize;

#include "lygia/generative/curl.glsl"
#include "lygia/generative/snoise.glsl"

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    // Read the static BASE position
    vec3 basePos = texture2D(uBase, uv).rgb;
    vec3 currentPos = texture2D(uParticles, uv).rgb;
    // vec3 velocity = texture2D(uVelocity, uv).rgb;
    vec3 velocity = vec3(0.0, 0.0, 0.0);
    
    // First frame: compute idealPos from basePos
    float t = uTime * uSpeed * 0.015;
    
    vec3 pos = basePos;
    vec3 curlPos = basePos;    
    
    // Apply curl transformations
    pos = curl(pos * uCurlFreq + t);
    curlPos = curl(curlPos * uCurlFreq + t);
    curlPos += curl(curlPos * uCurlFreq * 2.0) * 0.5;
    curlPos += curl(curlPos * uCurlFreq * 4.0) * 0.25;
    curlPos += curl(curlPos * uCurlFreq * 8.0) * 0.125;
    curlPos += curl(pos * uCurlFreq * 16.0) * 0.0625;

    vec3 idealPos = mix(pos, curlPos, snoise(pos + t));

    // rotate the ideal position
    float angle = uTime * -0.5; // Adjust 0.5 for spin speed
    float s = sin(angle);
    float c = cos(angle);
    mat2 rot = mat2(c, s, -s, c);
    // Rotate on the XZ plane (spinning around the Y axis)
    idealPos.xz *= rot;

    if(uInitialize) {
        
        gl_FragColor = vec4(idealPos, 1.0);
    } else {
        
        // Subsequent frames: apply velocity to current position
        vec3 nextPos = currentPos + velocity * uDeltaTime;
        gl_FragColor = vec4(nextPos, 1.0);
    }
}
