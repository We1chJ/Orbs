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
debugObject.speed = 0.5
debugObject.curlFreq = 0.25
debugObject.spinSpeed = 0.35
debugObject.attraction = 10000.0
debugObject.damping = 0.25
debugObject.accelNoiseScale = 60.0
debugObject.windowCameraScale = 0.005
debugObject.windowCameraSmoothness = 8.0
debugObject.windowResponseMin = 0.02
debugObject.windowResponseMax = 0.06

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
    initialScreenX: window.screenX,
    initialScreenY: window.screenY,
    currentScreenX: window.screenX,
    currentScreenY: window.screenY
}

let movement = new THREE.Vector2(0.0, 0.0)
const smoothedMovement = new THREE.Vector2(0.0, 0.0)
const cameraPanRight = new THREE.Vector3()
const cameraPanUp = new THREE.Vector3()
const desiredCameraPanOffset = new THREE.Vector3()
const appliedCameraPanOffset = new THREE.Vector3()
const cameraPanDeltaOffset = new THREE.Vector3()
const initialCameraCenter = new THREE.Vector3()
const cameraCenterOffset2D = new THREE.Vector2(0.0, 0.0)

const updateWindowMotion = () =>
{
    windowMotion.currentScreenX = window.screenX
    windowMotion.currentScreenY = window.screenY

    movement.set(
        windowMotion.currentScreenX - windowMotion.initialScreenX,
        windowMotion.currentScreenY - windowMotion.initialScreenY
    )
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
camera.position.set(0, 0, 7)
scene.add(camera)

// Controls
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
initialCameraCenter.copy(controls.target)

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
})
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(sizes.pixelRatio)

debugObject.clearColor = '#000000'
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
gpgpu.particlesVariable.material.uniforms.uTime = new THREE.Uniform(0)
gpgpu.particlesVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0)
gpgpu.particlesVariable.material.uniforms.uBase = new THREE.Uniform(baseParticlesTexture)
gpgpu.particlesVariable.material.uniforms.uCurlFreq = new THREE.Uniform(debugObject.curlFreq);
gpgpu.particlesVariable.material.uniforms.uSpeed = new THREE.Uniform(debugObject.speed);
gpgpu.particlesVariable.material.uniforms.uInitialize = new THREE.Uniform(true)

gpgpu.velocityVariable.material.uniforms.uTime = new THREE.Uniform(0)
gpgpu.velocityVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0)
gpgpu.velocityVariable.material.uniforms.uSpeed = new THREE.Uniform(debugObject.speed)
gpgpu.velocityVariable.material.uniforms.uCurlFreq = new THREE.Uniform(debugObject.curlFreq)
gpgpu.velocityVariable.material.uniforms.uAttraction = new THREE.Uniform(debugObject.attraction)
gpgpu.velocityVariable.material.uniforms.uDamping = new THREE.Uniform(debugObject.damping)
gpgpu.velocityVariable.material.uniforms.uAccelNoiseScale = new THREE.Uniform(debugObject.accelNoiseScale)
gpgpu.velocityVariable.material.uniforms.uBase = new THREE.Uniform(baseParticlesTexture)
gpgpu.velocityVariable.material.uniforms.uSpinSpeed = new THREE.Uniform(debugObject.spinSpeed)
gpgpu.velocityVariable.material.uniforms.uCameraCenterOffset = new THREE.Uniform(cameraCenterOffset2D)
gpgpu.velocityVariable.material.uniforms.uWindowResponseMin = new THREE.Uniform(debugObject.windowResponseMin)
gpgpu.velocityVariable.material.uniforms.uWindowResponseMax = new THREE.Uniform(debugObject.windowResponseMax)

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
        uFocus: { value: 7.3 },
        uFov: { value: 50 },
        uBlur: { value: 1 }
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false
})

// Points
particles.points = new THREE.Points(particles.geometry, particles.material)
// GPU-simulated positions are in shader space, so disable object-level culling.
particles.points.frustumCulled = false
scene.add(particles.points)

/**
 * Tweaks
 */
gui.addColor(debugObject, 'particleColor').onChange(() => { 
    particles.material.uniforms.uColor.value.set(debugObject.particleColor) 
}).name('Particle Color')
// gui.addColor(debugObject, 'clearColor').onChange(() => { renderer.setClearColor(debugObject.clearColor) })

const generalSettingFolder = gui.addFolder('General Setting')
generalSettingFolder.add(particles.material.uniforms.uFocus, 'value')
   .min(0.1)
   .max(20.0)
   .step(0.1)
   .name('Focus Distance')

generalSettingFolder.add(particles.material.uniforms.uBlur, 'value')
   .min(0)
   .max(100)
   .step(1)
   .name('Blur Strength')

generalSettingFolder.add(particles.material.uniforms.uFov, 'value')
   .min(20)
   .max(500)
   .step(1)
   .name('FOV Factor')

generalSettingFolder.add(debugObject, 'curlFreq')
    .min(0).max(0.5).step(0.01).name('Curl Frequency')
    .onChange((value) => {
          gpgpu.particlesVariable.material.uniforms.uCurlFreq.value = value
          gpgpu.velocityVariable.material.uniforms.uCurlFreq.value = value
    });

generalSettingFolder.add(debugObject, 'speed')
    .min(0.0).max(100.0).step(0.1).name('Speed')
    .onChange((value) => {
          gpgpu.particlesVariable.material.uniforms.uSpeed.value = value
          gpgpu.velocityVariable.material.uniforms.uSpeed.value = value
    });

generalSettingFolder.add(debugObject, 'spinSpeed')
    .min(0.0).max(3.0).step(0.01).name('Orb Spin Speed')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uSpinSpeed.value = value
    });

const particlesPhysicsFolder = gui.addFolder('Particles Physics')
particlesPhysicsFolder.add(debugObject, 'attraction')
    .min(0.0).max(50000.0).step(0.01).name('Attraction')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uAttraction.value = value
    });

particlesPhysicsFolder.add(debugObject, 'damping')
    .min(0.0).max(1.0).step(0.001).name('Damping')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uDamping.value = value
    });

particlesPhysicsFolder.add(debugObject, 'accelNoiseScale')
    .min(0.0).max(100.0).step(0.01).name('Accel Noise Scale')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uAccelNoiseScale.value = value
    });

const windowMotionRelatedFolder = gui.addFolder('Window Motion Related')
windowMotionRelatedFolder.add(debugObject, 'windowCameraScale')
    .min(0.0).max(0.05).step(0.001).name('Window Camera Scale');

windowMotionRelatedFolder.add(debugObject, 'windowCameraSmoothness')
    .min(0.0).max(30.0).step(0.1).name('Window Camera Smoothness');

windowMotionRelatedFolder.add(debugObject, 'windowResponseMin')
    .min(0.0).max(0.5).step(0.001).name('Window Response Min')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uWindowResponseMin.value = value
    });

windowMotionRelatedFolder.add(debugObject, 'windowResponseMax')
    .min(0.0).max(0.5).step(0.001).name('Window Response Max')
    .onChange((value) => {
        gpgpu.velocityVariable.material.uniforms.uWindowResponseMax.value = value
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

    const cameraSmoothAlpha = 1.0 - Math.exp(-debugObject.windowCameraSmoothness * deltaTime)
    smoothedMovement.lerp(movement, cameraSmoothAlpha)

    cameraPanRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
    cameraPanUp.set(0, 1, 0).applyQuaternion(camera.quaternion)

    desiredCameraPanOffset.copy(cameraPanRight).multiplyScalar(smoothedMovement.x * debugObject.windowCameraScale)
    desiredCameraPanOffset.addScaledVector(cameraPanUp, -smoothedMovement.y * debugObject.windowCameraScale)

    cameraPanDeltaOffset.copy(desiredCameraPanOffset).sub(appliedCameraPanOffset)
    camera.position.add(cameraPanDeltaOffset)
    controls.target.add(cameraPanDeltaOffset)
    appliedCameraPanOffset.copy(desiredCameraPanOffset)
    
    // Update controls
    controls.update()

    cameraCenterOffset2D.set(
        controls.target.x - initialCameraCenter.x,
        controls.target.y - initialCameraCenter.y
    )

    // GPGPU Update
    gpgpu.particlesVariable.material.uniforms.uTime.value = elapsedTime
    gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = deltaTime
    gpgpu.particlesVariable.material.uniforms.uSpeed.value = debugObject.speed
    gpgpu.particlesVariable.material.uniforms.uCurlFreq.value = debugObject.curlFreq
    gpgpu.velocityVariable.material.uniforms.uTime.value = elapsedTime
    gpgpu.velocityVariable.material.uniforms.uDeltaTime.value = deltaTime
    gpgpu.velocityVariable.material.uniforms.uSpeed.value = debugObject.speed
    gpgpu.velocityVariable.material.uniforms.uCurlFreq.value = debugObject.curlFreq
    gpgpu.velocityVariable.material.uniforms.uSpinSpeed.value = debugObject.spinSpeed
    gpgpu.velocityVariable.material.uniforms.uAttraction.value = debugObject.attraction
    gpgpu.velocityVariable.material.uniforms.uDamping.value = debugObject.damping
    gpgpu.velocityVariable.material.uniforms.uAccelNoiseScale.value = debugObject.accelNoiseScale
    gpgpu.velocityVariable.material.uniforms.uCameraCenterOffset.value.copy(cameraCenterOffset2D)
    gpgpu.velocityVariable.material.uniforms.uWindowResponseMin.value = debugObject.windowResponseMin
    gpgpu.velocityVariable.material.uniforms.uWindowResponseMax.value = debugObject.windowResponseMax
    gpgpu.computation.compute()
    gpgpu.particlesVariable.material.uniforms.uInitialize.value = false
    particles.material.uniforms.uParticlesTexture.value = gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture

    // Render normal scene
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()