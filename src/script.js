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
debugObject.particleColor = '#006602'

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


/**
 * Orb
 */

const orbs = {}
orbs.geometry = new THREE.SphereGeometry(
    1,    // radius
    512,   // width segments
    512    // height segments)
)
console.log(orbs.geometry.attributes.position.count)

/** 
 * Base geometry
 */
const baseGeometry = {}
baseGeometry.instance = orbs.geometry
baseGeometry.count = baseGeometry.instance.attributes.position.count

/**
 * GPU Compute
 */
// Setup
const gpgpu = {}
gpgpu.size = Math.ceil(Math.sqrt(baseGeometry.count))
gpgpu.computation = new GPUComputationRenderer(gpgpu.size, gpgpu.size, renderer)

// Base particles
const baseParticlecsTexture = gpgpu.computation.createTexture()
for(let i = 0; i < baseGeometry.count; i++) {
    const i3 = i*3;
    const i4 = i*4;

    // Position based on geometry
    baseParticlecsTexture.image.data[i4 + 0] = baseGeometry.instance.attributes.position.array[i3 + 0]
    baseParticlecsTexture.image.data[i4 + 1] = baseGeometry.instance.attributes.position.array[i3 + 1]
    baseParticlecsTexture.image.data[i4 + 2] = baseGeometry.instance.attributes.position.array[i3 + 2]
    baseParticlecsTexture.image.data[i4 + 3] = Math.random()
}

// Particles variable
gpgpu.particlesVariable = gpgpu.computation.addVariable('uParticles', gpgpuParticlesShader, baseParticlecsTexture)
gpgpu.computation.setVariableDependencies(gpgpu.particlesVariable, [gpgpu.particlesVariable])

// Uniforms
gpgpu.particlesVariable.material.uniforms.uTime = new THREE.Uniform(0)
gpgpu.particlesVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0)
gpgpu.particlesVariable.material.uniforms.uBase = new THREE.Uniform(baseParticlecsTexture)

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
const particlesUvArray = new Float32Array(baseGeometry.count * 2)
for(let y = 0; y < gpgpu.size; y++){
    for(let x = 0; x < gpgpu.size; x++){
        const i = (y * gpgpu.size) + x
        const i2 = i * 2
        
        const uvX = (x + 0.5) / gpgpu.size
        const uvY = (y + 0.5) / gpgpu.size

        particlesUvArray[i2 + 0] = uvX
        particlesUvArray[i2 + 1] = uvY        
    }
}

particles.geometry = new THREE.BufferGeometry()
particles.geometry.setDrawRange(0, baseGeometry.count)
particles.geometry.setAttribute('aParticlesUv', new THREE.BufferAttribute(particlesUvArray, 2))

// Material
particles.material = new THREE.ShaderMaterial({
    vertexShader: particlesVertexShader,
    fragmentShader: particlesFragmentShader,
    uniforms: {
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
// gui.addColor(debugObject, 'particleColor').onChange(() => { 
//     particles.material.uniforms.uColor.value.set(debugObject.particleColor) 
// }).name('Particle Color')
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
   .max(120)
   .step(1)
   .name('FOV Factor')

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