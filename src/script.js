import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GPUComputationRenderer } from 'three/examples/jsm/Addons.js'
import GUI from 'lil-gui'
import particlesVertexShader from './shaders/particles/vertex.glsl'
import particlesFragmentShader from './shaders/particles/fragment.glsl'
import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl'
import gpgpuVelocityShader from './shaders/gpgpu/velocity.glsl'

/**
 * Base
 */
// Debug
const gui = new GUI({ width: 340 })
const debugObject = {}
debugObject.particleColor = '#00ff6a'
debugObject.spinSpeed = 0.35
debugObject.curlFreq = 0.25
debugObject.flowSpeed = 1.0
debugObject.attraction = 500.0
debugObject.damping = 0.8
debugObject.motionForceScale = 40.0
debugObject.motionLerpSeconds = 0.5
debugObject.windowMotionTolerance = 5
debugObject.windowResponseMin = 0.02
debugObject.windowResponseMax = 0.06
debugObject.distortCurlScale = 10.0

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

const windowMotion = {
    previousScreenX: window.screenX,
    previousScreenY: window.screenY,
    currentScreenX: window.screenX,
    currentScreenY: window.screenY
}

let movement = new THREE.Vector2(0.0, 0.0)
const targetWindowForce = new THREE.Vector3(0.0, 0.0, 0.0)
const smoothedWindowForce = new THREE.Vector3(0.0, 0.0, 0.0)

const updateWindowMotion = () =>
{
    windowMotion.currentScreenX = window.screenX
    windowMotion.currentScreenY = window.screenY

    const dx = windowMotion.currentScreenX - windowMotion.previousScreenX
    const dy = windowMotion.currentScreenY - windowMotion.previousScreenY
    const toleranceSq = debugObject.windowMotionTolerance * debugObject.windowMotionTolerance

    if ((dx * dx + dy * dy) >= toleranceSq)
    {
        movement.set(dx, dy)
    }
    else
    {
        movement.set(0.0, 0.0)
    }

    if(
        movement.x !== 0.0 ||
        movement.y !== 0.0
    )
    {
        console.log(movement)
        
    }

    windowMotion.previousScreenX = windowMotion.currentScreenX
    windowMotion.previousScreenY = windowMotion.currentScreenY
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
camera.position.set(0, 0, 6)
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

const baseVelocityTexture = gpgpu.computation.createTexture()
for(let i = 0; i < particleCount; i++)
{
    const i4 = i * 4
    baseVelocityTexture.image.data[i4 + 0] = 0
    baseVelocityTexture.image.data[i4 + 1] = 0
    baseVelocityTexture.image.data[i4 + 2] = 0
    baseVelocityTexture.image.data[i4 + 3] = Math.random()
}

// Particles variable
gpgpu.particlesVariable = gpgpu.computation.addVariable('uParticles', gpgpuParticlesShader, baseParticlesTexture)
gpgpu.velocityVariable = gpgpu.computation.addVariable('uVelocity', gpgpuVelocityShader, baseVelocityTexture)

gpgpu.computation.setVariableDependencies(gpgpu.particlesVariable, [gpgpu.particlesVariable, gpgpu.velocityVariable])
gpgpu.computation.setVariableDependencies(gpgpu.velocityVariable, [gpgpu.particlesVariable, gpgpu.velocityVariable])

// Uniforms
gpgpu.particlesVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0)
gpgpu.particlesVariable.material.uniforms.uTime = new THREE.Uniform(0)
gpgpu.particlesVariable.material.uniforms.uBase = new THREE.Uniform(baseParticlesTexture)
gpgpu.particlesVariable.material.uniforms.uCurlFreq = new THREE.Uniform(debugObject.curlFreq)
gpgpu.particlesVariable.material.uniforms.uSpeed = new THREE.Uniform(debugObject.flowSpeed)
gpgpu.particlesVariable.material.uniforms.uInitialize = new THREE.Uniform(true)
gpgpu.velocityVariable.material.uniforms.uTime = new THREE.Uniform(0)
gpgpu.velocityVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0)
gpgpu.velocityVariable.material.uniforms.uBase = new THREE.Uniform(baseParticlesTexture)
gpgpu.velocityVariable.material.uniforms.uCurlFreq = new THREE.Uniform(debugObject.curlFreq);
gpgpu.velocityVariable.material.uniforms.uSpeed = new THREE.Uniform(debugObject.flowSpeed);
gpgpu.velocityVariable.material.uniforms.uAttraction = new THREE.Uniform(debugObject.attraction);
gpgpu.velocityVariable.material.uniforms.uDamping = new THREE.Uniform(debugObject.damping);
gpgpu.velocityVariable.material.uniforms.uSpinSpeed = new THREE.Uniform(debugObject.spinSpeed);
gpgpu.velocityVariable.material.uniforms.uWindowResponseMin = new THREE.Uniform(debugObject.windowResponseMin);
gpgpu.velocityVariable.material.uniforms.uWindowResponseMax = new THREE.Uniform(debugObject.windowResponseMax);
gpgpu.velocityVariable.material.uniforms.uDistortCurlScale = new THREE.Uniform(debugObject.distortCurlScale);
gpgpu.velocityVariable.material.uniforms.uWindowForce = new THREE.Uniform(new THREE.Vector3(0, 0, 0));

// Init
gpgpu.computation.init()

// Debug
gpgpu.debug = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.MeshBasicMaterial({
        map: gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture
    })
)
gpgpu.debug.visible = false
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
        uFocus: { value: 6.4 },
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

gui.add(debugObject, 'curlFreq')
   .min(0).max(0.5).step(0.01).name('Curl Frequency')
   .onChange((value) => {
       gpgpu.particlesVariable.material.uniforms.uCurlFreq.value = value
       gpgpu.velocityVariable.material.uniforms.uCurlFreq.value = value
   });

gui.add(debugObject, 'flowSpeed')
   .min(0.0).max(100.0).step(0.1).name('Speed')
   .onChange((value) => {
       gpgpu.particlesVariable.material.uniforms.uSpeed.value = value
       gpgpu.velocityVariable.material.uniforms.uSpeed.value = value
   });

gui.add(debugObject, 'attraction')
    .min(0.0).max(1000.0).step(0.01).name('Attraction')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uAttraction.value = value
    });

gui.add(debugObject, 'damping')
    .min(0.1).max(1.0).step(0.001).name('Damping')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uDamping.value = value
    });

gui.add(debugObject, 'motionForceScale')
    .min(0.0).max(1000.0).step(0.01).name('Window Force Scale');

gui.add(debugObject, 'windowMotionTolerance')
    .min(0.0).max(20.0).step(0.1).name('Window Motion Tolerance');

gui.add(debugObject, 'motionLerpSeconds')
    .min(0.05).max(10.0).step(0.01).name('Window Force Lerp (s)');

gui.add(debugObject, 'windowResponseMin')
    .min(0.005).max(1.0).step(0.005).name('Window Response Min (s)')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uWindowResponseMin.value = value
    });

gui.add(debugObject, 'windowResponseMax')
    .min(0.01).max(2.0).step(0.005).name('Window Response Max (s)')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uWindowResponseMax.value = value
    });

gui.add(debugObject, 'distortCurlScale')
    .min(0.1).max(100.0).step(0.1).name('Distort Curl Scale')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uDistortCurlScale.value = value
    });

gui.add(debugObject, 'spinSpeed')
    .min(0.0).max(10.0).step(0.01).name('Orb Spin Speed')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uSpinSpeed.value = value
    });

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

    updateWindowMotion()
    
    // Update controls
    controls.update()

    // GPGPU Update
    gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = deltaTime
    gpgpu.particlesVariable.material.uniforms.uTime.value = elapsedTime
    gpgpu.particlesVariable.material.uniforms.uCurlFreq.value = gpgpu.velocityVariable.material.uniforms.uCurlFreq.value
    gpgpu.particlesVariable.material.uniforms.uSpeed.value = gpgpu.velocityVariable.material.uniforms.uSpeed.value
    gpgpu.velocityVariable.material.uniforms.uTime.value = elapsedTime
    gpgpu.velocityVariable.material.uniforms.uDeltaTime.value = deltaTime
    gpgpu.velocityVariable.material.uniforms.uSpinSpeed.value = debugObject.spinSpeed
    targetWindowForce.set(
        movement.x * debugObject.motionForceScale,
        -movement.y * debugObject.motionForceScale,
        0.0
    )
    const alpha = Math.min(deltaTime / Math.max(debugObject.motionLerpSeconds, 0.0001), 1.0)
    smoothedWindowForce.lerp(targetWindowForce, alpha)
    gpgpu.velocityVariable.material.uniforms.uWindowForce.value.copy(smoothedWindowForce)
    gpgpu.computation.compute()
    gpgpu.particlesVariable.material.uniforms.uInitialize.value = false
    particles.material.uniforms.uParticlesTexture.value = gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture

    // Render normal scene
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()