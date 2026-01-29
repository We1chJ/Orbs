import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GPUComputationRenderer } from 'three/examples/jsm/Addons.js'
import GUI from 'lil-gui'
import particlesVertexShader from './shaders/particles/vertex.glsl'
import particlesFragmentShader from './shaders/particles/fragment.glsl'
import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl'

/**
 * Base
 */
// Debug
const gui = new GUI({ width: 340 })
const debugObject = {}
debugObject.particleColor = '#00ff6a'

// Canvas
const canvas = document.querySelector('canvas.webgl')

// Scene
const scene = new THREE.Scene()

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: Math.min(window.devicePixelRatio, 2)
}

window.addEventListener('resize', () =>
{
    // Update sizes
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    sizes.pixelRatio = Math.min(window.devicePixelRatio, 2)

    // Materials
    particles.material.uniforms.uResolution.value.set(sizes.width * sizes.pixelRatio, sizes.height * sizes.pixelRatio)

    // Update camera
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    // Update renderer
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(sizes.pixelRatio)
})

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(35, sizes.width / sizes.height, 0.1, 100)
camera.position.set(4.5, 4, 11)
scene.add(camera)

// Controls
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
})
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(sizes.pixelRatio)

debugObject.clearColor = '#29191f'
renderer.setClearColor(debugObject.clearColor)

const particleCount = 512 * 512; 
const textureSize = 512;          // square texture side length

// Helper: generate one random point INSIDE unit sphere (not just surface)
function getRandomSpherePoint() {
    const v = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
    );
    if (v.length() > 1) {
        return getRandomSpherePoint();
    }
    return v.normalize();
}


// Create initial positions texture data
const baseParticlesData = new Float32Array(particleCount * 4);
const radius = 128; // Match original

for (let i = 0; i < particleCount; i++) {
    const i4 = i * 4;
    const point = getRandomSpherePoint(); // Now returns normalized vector
    
    baseParticlesData[i4 + 0] = point.x * radius;
    baseParticlesData[i4 + 1] = point.y * radius;
    baseParticlesData[i4 + 2] = point.z * radius;
    baseParticlesData[i4 + 3] = 1.0;
}
/**
 * GPU Compute
 */
// Setup
const gpgpu = {}
gpgpu.size = textureSize
gpgpu.computation = new GPUComputationRenderer(gpgpu.size, gpgpu.size, renderer)

// Base particles
const baseParticlesTexture = gpgpu.computation.createTexture()
baseParticlesTexture.image.data = baseParticlesData;

// Particles variable
gpgpu.particlesVariable = gpgpu.computation.addVariable('uParticles', gpgpuParticlesShader, baseParticlesTexture)

// Uniforms
gpgpu.particlesVariable.material.uniforms.uTime = new THREE.Uniform(0)
gpgpu.particlesVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0)
gpgpu.particlesVariable.material.uniforms.uBase = new THREE.Uniform(baseParticlesTexture)
gpgpu.particlesVariable.material.uniforms.uCurlFreq = new THREE.Uniform(0.25);
gpgpu.particlesVariable.material.uniforms.uSpeed = new THREE.Uniform(0.015);

// Init
gpgpu.computation.init()

// Debug
gpgpu.debug = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.MeshBasicMaterial({
        map: gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture
    })
)
// gpgpu.debug.visible = false
gpgpu.debug.position.x = 3
scene.add(gpgpu.debug)


/**
 * Particles
 */
const particles = {}

// Geometry
const particlesUvArray = new Float32Array(particleCount * 2)
for(let y = 0; y < gpgpu.size; y++){
    for(let x = 0; x < gpgpu.size; x++){
        const i = (y * gpgpu.size + x) * 2;
        particlesUvArray[i + 0] = x / gpgpu.size;
        particlesUvArray[i + 1] = y / gpgpu.size;     
    }
}

particles.geometry = new THREE.BufferGeometry()
particles.geometry.setDrawRange(0, particleCount)
particles.geometry.setAttribute('aParticlesUv', new THREE.BufferAttribute(particlesUvArray, 2))

// Material
particles.material = new THREE.ShaderMaterial({
    vertexShader: particlesVertexShader,
    fragmentShader: particlesFragmentShader,
    uniforms: {
        uColor: new THREE.Uniform(new THREE.Color(debugObject.particleColor)),
        uParticlesTexture: new THREE.Uniform(),
        uTime: { value: 0 },
        uFocus: { value: 12.8 },
        uFov: { value: 50 },
        uBlur: { value: 1 }
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false
})

// Points
particles.points = new THREE.Points(particles.geometry, particles.material)
scene.add(particles.points)

/**
 * Tweaks
 */
gui.addColor(debugObject, 'particleColor').onChange(() => { 
    particles.material.uniforms.uColor.value.set(debugObject.particleColor) 
}).name('Particle Color')
// gui.addColor(debugObject, 'clearColor').onChange(() => { renderer.setClearColor(debugObject.clearColor) })
// DoF Controls
gui.add(particles.material.uniforms.uFocus, 'value')
   .min(0.1)
   .max(20.0)
   .step(0.1)
   .name('Focus Distance')

gui.add(particles.material.uniforms.uBlur, 'value')
   .min(0)
   .max(100)
   .step(1)
   .name('Blur Strength')

gui.add(particles.material.uniforms.uFov, 'value')
   .min(20)
   .max(500)
   .step(1)
   .name('FOV Factor')

gui.add(gpgpu.particlesVariable.material.uniforms.uCurlFreq, 'value')
   .min(0).max(0.5).step(0.01).name('Curl Frequency');

gui.add(gpgpu.particlesVariable.material.uniforms.uSpeed, 'value')
   .min(0.0).max(100.0).step(0.1).name('Speed');

/**
 * Animate
 */
const clock = new THREE.Clock()
let previousTime = 0

const tick = () =>
{
    const elapsedTime = clock.getElapsedTime()
    const deltaTime = elapsedTime - previousTime
    previousTime = elapsedTime
    
    // Update controls
    controls.update()

    // GPGPU Update
    gpgpu.particlesVariable.material.uniforms.uTime.value = elapsedTime
    gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = deltaTime
    gpgpu.computation.compute()
    particles.material.uniforms.uParticlesTexture.value = gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture

    // Render normal scene
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()