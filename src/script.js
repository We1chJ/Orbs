import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GPUComputationRenderer } from 'three/examples/jsm/Addons.js'
import GUI from 'lil-gui'
import particlesVertexShader from './shaders/particles/vertex.glsl'
import particlesFragmentShader from './shaders/particles/fragment.glsl'
import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl'
import gpgpuVelocityShader from './shaders/gpgpu/velocity.glsl'
import gpgpuStreamParticlesShader from './shaders/gpgpu/streamParticles.glsl'
import gpgpuStreamVelocityShader from './shaders/gpgpu/streamVelocity.glsl'
import streamParticlesVertexShader from './shaders/stream/vertex.glsl'
import streamParticlesFragmentShader from './shaders/stream/fragment.glsl'
import { publishOrbState, readRemoteOrbStates, cleanupOrbState } from './cross-tab-sync.js'

// ─────────────────────────────────────────────────────────────────────────────
// Window-index bookkeeping
// ─────────────────────────────────────────────────────────────────────────────
const WINDOW_INDEX_KEY          = 'orbs.windowIndex'
const ACTIVE_WINDOW_INDICES_KEY = 'orbs.activeWindowIndices'

const getActiveWindowIndices = () => {
    try {
        const raw = localStorage.getItem(ACTIVE_WINDOW_INDICES_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return [...new Set(parsed.map(Number).filter(v => Number.isInteger(v) && v >= 0))].sort((a,b) => a-b)
    } catch { return [] }
}

const setActiveWindowIndices = (indices) => {
    const n = [...new Set(indices.map(Number).filter(v => Number.isInteger(v) && v >= 0))].sort((a,b) => a-b)
    localStorage.setItem(ACTIVE_WINDOW_INDICES_KEY, JSON.stringify(n))
}

const findLowestAvailableIndex = (indices) => {
    let c = 0
    for (const i of indices) { if (i === c) { c++; continue } if (i > c) break }
    return c
}

const registerWindowIndex = (idx) => {
    const indices = getActiveWindowIndices()
    if (!indices.includes(idx)) { indices.push(idx); setActiveWindowIndices(indices) }
}

const releaseWindowIndex = (idx) => setActiveWindowIndices(getActiveWindowIndices().filter(v => v !== idx))

const getOrCreateWindowIndex = () => {
    try {
        const existing = sessionStorage.getItem(WINDOW_INDEX_KEY)
        if (existing !== null) {
            const p = Number(existing)
            if (Number.isFinite(p) && p >= 0) { registerWindowIndex(p); return p }
        }
        const active   = getActiveWindowIndices()
        const assigned = findLowestAvailableIndex(active)
        active.push(assigned)
        setActiveWindowIndices(active)
        sessionStorage.setItem(WINDOW_INDEX_KEY, String(assigned))
        return assigned
    } catch { return 0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────
const indexPalette = ['#00ff6a', '#ff2a2a', '#4ac7ff', '#ffd166', '#ff9ef5', '#ffe566', '#66fffa', '#ff8c42']
const NESTED_ORB_SCALE = 0.40

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
const gui = new GUI({ width: 340 })
// gui.hide()
const debugObject = {}
const windowIndex = getOrCreateWindowIndex()

const setupWindowIndexCleanup = () => {
    let released = false
    const releaseOnce = () => {
        if (released) return
        released = true
        try {
            cleanupOrbState(windowIndex)
            releaseWindowIndex(windowIndex)
            sessionStorage.removeItem(WINDOW_INDEX_KEY)
        } catch {}
    }
    window.addEventListener('pagehide',     releaseOnce)
    window.addEventListener('beforeunload', releaseOnce)
}
setupWindowIndexCleanup()

debugObject.particleColor     = indexPalette[windowIndex % indexPalette.length]
debugObject.speed             = 0.5
debugObject.curlFreq          = 0.25
debugObject.spinSpeed         = 0.35
debugObject.attraction        = 10000.0
debugObject.damping           = 0.132
debugObject.accelNoiseScale   = 60.0
debugObject.windowResponseMin = 0.02
debugObject.windowResponseMax = 0.06

console.info(`[Orbs] window index ${windowIndex}`)
document.title = `Orbs [${windowIndex}]`

// ─────────────────────────────────────────────────────────────────────────────
// Canvas / Scene
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.querySelector('canvas.webgl')
const scene  = new THREE.Scene()

// ─────────────────────────────────────────────────────────────────────────────
// Sizes
// ─────────────────────────────────────────────────────────────────────────────
const sizes = {
    width:      window.innerWidth,
    height:     window.innerHeight,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────────────────────
const CAMERA_FOV = 35  // degrees — must stay constant for alignment to work
const CAMERA_Z   = 7   // world-space distance from the z=0 look-at plane

const camera = new THREE.PerspectiveCamera(CAMERA_FOV, sizes.width / sizes.height, 0.1, 100)
camera.position.set(0, 0, CAMERA_Z)
scene.add(camera)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.target.set(0, 0, 0)

// ─────────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(sizes.pixelRatio)
renderer.setClearColor('#000000')

window.addEventListener('resize', () => {
    sizes.width      = window.innerWidth
    sizes.height     = window.innerHeight
    sizes.pixelRatio = Math.min(window.devicePixelRatio, 2)
    for (const orb of orbInstances.values()) {
        orb.material.uniforms.uResolution.value.set(sizes.width * sizes.pixelRatio, sizes.height * sizes.pixelRatio)
    }
    for (const nested of nestedOrbInstances.values()) {
        nested.material.uniforms.uResolution.value.set(sizes.width * sizes.pixelRatio, sizes.height * sizes.pixelRatio)
    }
    for (const stream of streamInstances.values()) {
        stream.material.uniforms.uResolution.value.set(sizes.width * sizes.pixelRatio, sizes.height * sizes.pixelRatio)
    }
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(sizes.pixelRatio)
})

// ─────────────────────────────────────────────────────────────────────────────
// Pixel-perfect view alignment
//
// Every tab uses the same world coordinate system anchored to the monitor
// center.  The camera in each tab is positioned so that its viewport
// corresponds exactly to where the OS window sits on the physical screen.
//
// Key formula
// ───────────
//   At the z=0 plane (camera at z = CAMERA_Z) the visible height in world
//   units is:
//
//     worldHeight = 2 * tan(fov/2) * CAMERA_Z
//
//   One CSS pixel therefore maps to:
//
//     worldUnitsPerPixel = worldHeight / window.innerHeight
//
//   The viewport's top-left corner in OS screen space:
//
//     vpLeft = window.screenX + (outerWidth  − innerWidth)  / 2
//     vpTop  = window.screenY + (outerHeight − innerHeight)      ← full chrome
//
//   (outerHeight − innerHeight) captures every pixel of browser chrome:
//   tab strip, address bar, bookmarks bar, security indicators, etc.
//   It is zero only when the page is truly fullscreen.
//
//   Viewport center in screen space:
//
//     vpCX = vpLeft + innerWidth  / 2
//     vpCY = vpTop  + innerHeight / 2
//
//   Offset from monitor center (screen.width/2, screen.height/2):
//
//     dx =  vpCX − screen.width  / 2      (right is +)
//     dy =  vpCY − screen.height / 2      (down  is +, in screen coords)
//
//   World offset (Y is flipped because world Y grows upward):
//
//     worldX =  dx * worldUnitsPerPixel
//     worldY = −dy * worldUnitsPerPixel
//
//   We then set camera.position.xy = controls.target.xy = (worldX, worldY)
//   so the camera looks straight ahead, making the projection a simple
//   lateral crop of the shared world.
// ─────────────────────────────────────────────────────────────────────────────
const getViewportWorldOffset = () => {
    const fovRad             = (CAMERA_FOV * Math.PI) / 180
    const worldUnitsPerPixel = (2 * Math.tan(fovRad / 2) * CAMERA_Z) / window.innerHeight

    const chromeX = Math.max(window.outerWidth  - window.innerWidth,  0)
    const chromeY = Math.max(window.outerHeight - window.innerHeight, 0)

    const vpLeft = window.screenX + chromeX / 2
    const vpTop  = window.screenY + chromeY

    const vpCX = vpLeft + window.innerWidth  / 2
    const vpCY = vpTop  + window.innerHeight / 2

    const dx =  vpCX - screen.width  / 2
    const dy =  vpCY - screen.height / 2

    return {
        x:  dx * worldUnitsPerPixel,
        y: -dy * worldUnitsPerPixel,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GPGPU / particle helpers
// ─────────────────────────────────────────────────────────────────────────────
const PARTICLE_COUNT = 256 * 256
const NESTED_PARTICLE_COUNT = 128 * 128
const TEXTURE_SIZE   = 256
const STREAM_TEXTURE_SIZE = 256
const STREAM_PARTICLE_COUNT = STREAM_TEXTURE_SIZE * STREAM_TEXTURE_SIZE
const STREAM_SPEED_MIN = 0.22
const STREAM_SPEED_MAX = 0.82
const STREAM_START_RADIUS_RATIO = 0.055   // wide entry  (~5.5% of path length)
const STREAM_END_RADIUS_RATIO   = 0.028   // wide exit   (~2.8% of path length)
const STREAM_NECK_RADIUS_RATIO  = 0.006   // tight neck  (~0.6% of path length)
const STREAM_PINCH_SHARPNESS    = 0.65    // < 1 → softer quadratic so hourglass reads clearly
const STREAM_RADIAL_SHELL_MIN   = 0.15    // allow particles near center for depth
const STREAM_LIFETIME_SCALE_MIN = 0.90
const STREAM_LIFETIME_SCALE_MAX = 2.0

function getRandomSpherePoint() {
    const v = new THREE.Vector3(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1)
    return v.length() > 1 ? getRandomSpherePoint() : v.normalize()
}

function buildParticlesUvAttribute(textureSize = TEXTURE_SIZE, particleCount = PARTICLE_COUNT) {
    const arr = new Float32Array(particleCount * 2)
    for (let y = 0; y < textureSize; y++) {
        for (let x = 0; x < textureSize; x++) {
            const i = (y * textureSize + x) * 2
            arr[i]   = x / textureSize
            arr[i+1] = y / textureSize
        }
    }
    return new THREE.BufferAttribute(arr, 2)
}

function buildBaseParticlesTexture(computation) {
    const data   = new Float32Array(PARTICLE_COUNT * 4)
    const radius = 128
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i4 = i * 4
        const pt = getRandomSpherePoint()
        data[i4]   = pt.x * radius
        data[i4+1] = pt.y * radius
        data[i4+2] = pt.z * radius
        data[i4+3] = 1.0
    }
    const tex = computation.createTexture()
    tex.image.data = data
    return tex
}

function buildBaseVelocityTexture(computation) {
    const tex = computation.createTexture()
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i4 = i * 4
        tex.image.data[i4]   = 0
        tex.image.data[i4+1] = 0
        tex.image.data[i4+2] = 0
        tex.image.data[i4+3] = Math.random()
    }
    return tex
}

function buildBaseStreamParticlesTexture(computation) {
    const tex = computation.createTexture()
    const data = tex.image.data
    for (let i = 0; i < STREAM_PARTICLE_COUNT; i++) {
        const i4 = i * 4
        data[i4]   = 0.0
        data[i4+1] = 0.0
        data[i4+2] = 0.0
        data[i4+3] = Math.random()
    }
    return tex
}

const streamSamplingDistributionCache = new Map() // `${orbIndex}:${roleSeed}` -> { cdf, totalWeight }

const clamp01 = (v) => Math.min(Math.max(v, 0), 1)
const fract = (v) => v - Math.floor(v)
const lerp = (a, b, t) => a + (b - a) * t
const smooth01 = (t) => t * t * (3 - 2 * t)

function hash31(x, y, z) {
    return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123)
}

function valueNoise3d(x, y, z) {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z)
    const x1 = x0 + 1,         y1 = y0 + 1,         z1 = z0 + 1
    const tx = smooth01(x - x0)
    const ty = smooth01(y - y0)
    const tz = smooth01(z - z0)

    const n000 = hash31(x0, y0, z0), n100 = hash31(x1, y0, z0)
    const n010 = hash31(x0, y1, z0), n110 = hash31(x1, y1, z0)
    const n001 = hash31(x0, y0, z1), n101 = hash31(x1, y0, z1)
    const n011 = hash31(x0, y1, z1), n111 = hash31(x1, y1, z1)

    const nx00 = lerp(n000, n100, tx), nx10 = lerp(n010, n110, tx)
    const nx01 = lerp(n001, n101, tx), nx11 = lerp(n011, n111, tx)
    const nxy0 = lerp(nx00, nx10, ty), nxy1 = lerp(nx01, nx11, ty)
    return lerp(nxy0, nxy1, tz)
}

function fbm3d(x, y, z, octaves = 4) {
    let amplitude = 0.5
    let frequency = 1.0
    let total = 0.0
    let norm = 0.0

    for (let i = 0; i < octaves; i++) {
        total += amplitude * valueNoise3d(x * frequency, y * frequency, z * frequency)
        norm += amplitude
        amplitude *= 0.5
        frequency *= 2.03
    }
    return norm > 0 ? total / norm : 0
}

// Number of emission hotspots per (orb, role) and how tight each one is.
// STREAM_HOTSPOT_SIGMA controls the angular width — smaller = tighter patch.
// With sigma = 0.22, each hotspot covers roughly a 25°-radius cap on the sphere.
const STREAM_HOTSPOT_COUNT = 3
const STREAM_HOTSPOT_SIGMA = 0.22

// Deterministic unit-vector hotspots per (orb, role).  Uses hashed spherical
// coords so the same orb always emits from the same patches across tabs.
function generateOrbHotspots(orbIndex, roleSeed, count) {
    const hotspots = []
    for (let i = 0; i < count; i++) {
        const s1 = fract(Math.sin(orbIndex * 31.7 + roleSeed * 53.3 + i * 17.1) * 43758.5453)
        const s2 = fract(Math.sin(orbIndex * 11.3 + roleSeed * 71.9 + i * 29.7) * 12345.6789)
        const theta = s1 * Math.PI * 2
        const cosPhi = 2 * s2 - 1
        const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi))
        hotspots.push({
            x: sinPhi * Math.cos(theta),
            y: sinPhi * Math.sin(theta),
            z: cosPhi,
        })
    }
    return hotspots
}

function computeSurfaceSamplingWeight(nx, ny, nz, hotspots) {
    // Sum of Gaussians centered on each hotspot direction.  Distance is the
    // chord-squared between (nx,ny,nz) and the hotspot — it's 0 on top of a
    // hotspot and grows smoothly as you move away.  Outside the Gaussian cap
    // the weight drops essentially to zero, giving clean empty regions.
    const invTwoSigmaSq = 1 / (2 * STREAM_HOTSPOT_SIGMA * STREAM_HOTSPOT_SIGMA)
    let weight = 0
    for (let i = 0; i < hotspots.length; i++) {
        const h = hotspots[i]
        const d = 1 - (nx * h.x + ny * h.y + nz * h.z)   // 0 at center, 2 opposite
        weight += Math.exp(-d * d * invTwoSigmaSq)
    }
    // Tiny floor so the sampler never NaNs if a sphere has no points near a
    // hotspot; in practice 99%+ of the weight lives inside the caps.
    return 0.0005 + weight
}

function getOrBuildStreamSamplingDistribution(orb, roleSeed) {
    if (!orb || !orb.baseParticlesTexture || !orb.baseParticlesTexture.image) return null

    const cacheKey = `${orb.orbIndex}:${roleSeed}`
    if (streamSamplingDistributionCache.has(cacheKey)) {
        return streamSamplingDistributionCache.get(cacheKey)
    }

    const baseData = orb.baseParticlesTexture.image.data
    if (!baseData || baseData.length < PARTICLE_COUNT * 4) return null

    const hotspots = generateOrbHotspots(orb.orbIndex, roleSeed, STREAM_HOTSPOT_COUNT)
    const cdf = new Float32Array(PARTICLE_COUNT)
    let totalWeight = 0.0

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i4 = i * 4
        const x = baseData[i4]
        const y = baseData[i4 + 1]
        const z = baseData[i4 + 2]
        const invLen = 1.0 / Math.max(Math.hypot(x, y, z), 1e-6)
        const nx = x * invLen
        const ny = y * invLen
        const nz = z * invLen

        totalWeight += computeSurfaceSamplingWeight(nx, ny, nz, hotspots)
        cdf[i] = totalWeight
    }

    const distribution = { cdf, totalWeight }
    streamSamplingDistributionCache.set(cacheKey, distribution)
    return distribution
}

function sampleParticleIndex(distribution) {
    if (!distribution || distribution.totalWeight <= 0) {
        return Math.floor(Math.random() * PARTICLE_COUNT)
    }

    const r = Math.random() * distribution.totalWeight
    const cdf = distribution.cdf
    let lo = 0
    let hi = cdf.length - 1

    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (r <= cdf[mid]) hi = mid
        else lo = mid + 1
    }
    return lo
}

function buildBaseStreamVelocityTexture(computation, sourceOrb, targetOrb) {
    const tex = computation.createTexture()
    const data = tex.image.data
    const sourceDistribution = getOrBuildStreamSamplingDistribution(sourceOrb, 0)
    const targetDistribution = getOrBuildStreamSamplingDistribution(targetOrb, 1)

    for (let i = 0; i < STREAM_PARTICLE_COUNT; i++) {
        const i4 = i * 4
        const sourceIndex = sampleParticleIndex(sourceDistribution)
        const targetIndex = sampleParticleIndex(targetDistribution)
        const sx = sourceIndex % TEXTURE_SIZE
        const sy = Math.floor(sourceIndex / TEXTURE_SIZE)
        const tx = targetIndex % TEXTURE_SIZE
        const ty = Math.floor(targetIndex / TEXTURE_SIZE)

        // Store sampled particle UV pairs:
        //   rg = source(big orb) sample
        //   ba = target(big orb -> nested small orb) sample
        data[i4]   = (sx + 0.5) / TEXTURE_SIZE
        data[i4+1] = (sy + 0.5) / TEXTURE_SIZE
        data[i4+2] = (tx + 0.5) / TEXTURE_SIZE
        data[i4+3] = (ty + 0.5) / TEXTURE_SIZE
    }
    return tex
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-orb attractor positions (world units, Vector2)
// Stored by orbIndex; passed by reference into each orb's velocity shader.
// ─────────────────────────────────────────────────────────────────────────────
const allOrbWorldOffsets = new Map()   // orbIndex → THREE.Vector2

const getOrCreateOrbWorldOffsetRef = (orbIndex) => {
    if (!allOrbWorldOffsets.has(orbIndex)) {
        allOrbWorldOffsets.set(orbIndex, new THREE.Vector2(0, 0))
    }
    return allOrbWorldOffsets.get(orbIndex)
}

// ─────────────────────────────────────────────────────────────────────────────
// Orb factory
// ─────────────────────────────────────────────────────────────────────────────
function createOrb(orbIndex) {
    const color = indexPalette[orbIndex % indexPalette.length]
    const cameraCenterOffsetRef = getOrCreateOrbWorldOffsetRef(orbIndex)

    // Per-orb personality — deterministic jitter seeded from orbIndex so every
    // window seeing orb N agrees on the same variation.
    const spinVariance = (((orbIndex * 7 + 3) % 9)  / 9  - 0.5) * 0.30   // ±0.15
    const curlVariance = (((orbIndex * 13 + 5) % 11) / 11 - 0.5) * 0.12  // ±0.06
    const orbSpinSpeed = Math.max(0.05, debugObject.spinSpeed + spinVariance)
    const orbCurlFreq  = Math.max(0.05, debugObject.curlFreq  + curlVariance)

    // ── GPGPU ──────────────────────────────────────────────────────────────
    const computation = new GPUComputationRenderer(TEXTURE_SIZE, TEXTURE_SIZE, renderer)
    const basePosTex  = buildBaseParticlesTexture(computation)
    const baseVelTex  = buildBaseVelocityTexture(computation)

    const particlesVar = computation.addVariable('uParticles', gpgpuParticlesShader, basePosTex)
    const velocityVar  = computation.addVariable('uVelocity',  gpgpuVelocityShader,  baseVelTex)

    computation.setVariableDependencies(particlesVar, [particlesVar, velocityVar])
    computation.setVariableDependencies(velocityVar,  [particlesVar, velocityVar])

    particlesVar.material.uniforms.uTime       = new THREE.Uniform(0)
    particlesVar.material.uniforms.uDeltaTime  = new THREE.Uniform(0)
    particlesVar.material.uniforms.uBase       = new THREE.Uniform(basePosTex)
    particlesVar.material.uniforms.uCurlFreq   = new THREE.Uniform(orbCurlFreq)
    particlesVar.material.uniforms.uSpeed      = new THREE.Uniform(debugObject.speed)
    particlesVar.material.uniforms.uInitialize = new THREE.Uniform(true)

    velocityVar.material.uniforms.uTime               = new THREE.Uniform(0)
    velocityVar.material.uniforms.uDeltaTime          = new THREE.Uniform(0)
    velocityVar.material.uniforms.uSpeed              = new THREE.Uniform(debugObject.speed)
    velocityVar.material.uniforms.uCurlFreq           = new THREE.Uniform(orbCurlFreq)
    velocityVar.material.uniforms.uAttraction         = new THREE.Uniform(debugObject.attraction)
    velocityVar.material.uniforms.uDamping            = new THREE.Uniform(debugObject.damping)
    velocityVar.material.uniforms.uAccelNoiseScale    = new THREE.Uniform(debugObject.accelNoiseScale)
    velocityVar.material.uniforms.uBase               = new THREE.Uniform(basePosTex)
    velocityVar.material.uniforms.uSpinSpeed          = new THREE.Uniform(orbSpinSpeed)
    velocityVar.material.uniforms.uCameraCenterOffset = new THREE.Uniform(cameraCenterOffsetRef)
    velocityVar.material.uniforms.uWindowResponseMin  = new THREE.Uniform(debugObject.windowResponseMin)
    velocityVar.material.uniforms.uWindowResponseMax  = new THREE.Uniform(debugObject.windowResponseMax)

    computation.init()

    // ── Render mesh ────────────────────────────────────────────────────────
    const geometry = new THREE.BufferGeometry()
    geometry.setDrawRange(0, PARTICLE_COUNT)
    geometry.setAttribute('aParticlesUv', buildParticlesUvAttribute())

    const material = new THREE.ShaderMaterial({
        vertexShader:   particlesVertexShader,
        fragmentShader: particlesFragmentShader,
        uniforms: {
            uColor:            new THREE.Uniform(new THREE.Color(color)),
            uOpacity:          new THREE.Uniform(1.0),
            uBrightness:       new THREE.Uniform(1.0),
            uParticlesTexture: new THREE.Uniform(),
            uNestedCenter:     new THREE.Uniform(cameraCenterOffsetRef),
            uNestedScale:      new THREE.Uniform(1.0),
            uResolution:       new THREE.Uniform(new THREE.Vector2(
                sizes.width * sizes.pixelRatio,
                sizes.height * sizes.pixelRatio
            )),
            uTime:  { value: 0 },
            uFocus: { value: 7.3 },
            uFov:   { value: 50 },
            uBlur:  { value: 1 },
        },
        transparent: true,
        blending:    THREE.NormalBlending,
        depthWrite:  false,
    })

    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    scene.add(points)

    console.info(`[Orbs] created orb ${orbIndex} (${color})`)

    return {
        orbIndex,
        computation,
        particlesVar,
        velocityVar,
        geometry,
        material,
        points,
        baseParticlesTexture: basePosTex,
        initialized: false,
        orbSpinSpeed,
        orbCurlFreq,
    }
}

function getCounterpartIndex(orbIndex, activeIndices) {
    for (const idx of activeIndices) {
        if (idx !== orbIndex) return idx
    }
    return null
}

function createNestedOrb(parentOrbIndex, activeIndices) {
    const parentOffsetRef = getOrCreateOrbWorldOffsetRef(parentOrbIndex)
    const counterpartIndex = getCounterpartIndex(parentOrbIndex, activeIndices)
    const nestedColorIndex = counterpartIndex ?? parentOrbIndex

    const geometry = new THREE.BufferGeometry()
    geometry.setDrawRange(0, NESTED_PARTICLE_COUNT)
    geometry.setAttribute('aParticlesUv', buildParticlesUvAttribute())

    const material = new THREE.ShaderMaterial({
        vertexShader:   particlesVertexShader,
        fragmentShader: particlesFragmentShader,
        uniforms: {
            uColor:            new THREE.Uniform(new THREE.Color(indexPalette[nestedColorIndex % indexPalette.length])),
            uOpacity:          new THREE.Uniform(0.95),
            uBrightness:       new THREE.Uniform(0.85),
            uParticlesTexture: new THREE.Uniform(),
            uNestedCenter:     new THREE.Uniform(parentOffsetRef),
            uNestedScale:      new THREE.Uniform(NESTED_ORB_SCALE),
            uResolution:       new THREE.Uniform(new THREE.Vector2(
                sizes.width * sizes.pixelRatio,
                sizes.height * sizes.pixelRatio
            )),
            uTime:  { value: 0 },
            uFocus: { value: 7.3 },
            uFov:   { value: 50 },
            uBlur:  { value: 1 },
        },
        transparent: true,
        blending:    THREE.NormalBlending,
        depthWrite:  false,
    })

    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    scene.add(points)

    return { parentOrbIndex, counterpartIndex, geometry, material, points }
}

function createStream(sourceOrbIndex, targetOrbIndex) {
    const targetOffsetRef = getOrCreateOrbWorldOffsetRef(targetOrbIndex)
    const sourceOrb = orbInstances.get(sourceOrbIndex)
    const targetOrb = orbInstances.get(targetOrbIndex)

    const computation = new GPUComputationRenderer(STREAM_TEXTURE_SIZE, STREAM_TEXTURE_SIZE, renderer)
    const basePosTex = buildBaseStreamParticlesTexture(computation)
    const baseVelTex = buildBaseStreamVelocityTexture(computation, sourceOrb, targetOrb)

    const particlesVar = computation.addVariable('uStreamParticles', gpgpuStreamParticlesShader, basePosTex)
    const velocityVar = computation.addVariable('uStreamVelocity', gpgpuStreamVelocityShader, baseVelTex)

    computation.setVariableDependencies(particlesVar, [particlesVar, velocityVar])
    computation.setVariableDependencies(velocityVar, [particlesVar, velocityVar])

    particlesVar.material.uniforms.uDeltaTime = new THREE.Uniform(0)
    particlesVar.material.uniforms.uSourceParticlesTexture = new THREE.Uniform(basePosTex)
    particlesVar.material.uniforms.uTargetParticlesTexture = new THREE.Uniform(basePosTex)
    particlesVar.material.uniforms.uTargetNestedCenter = new THREE.Uniform(targetOffsetRef)
    particlesVar.material.uniforms.uTargetNestedScale = new THREE.Uniform(NESTED_ORB_SCALE)
    particlesVar.material.uniforms.uSpeedMin = new THREE.Uniform(STREAM_SPEED_MIN)
    particlesVar.material.uniforms.uSpeedMax = new THREE.Uniform(STREAM_SPEED_MAX)
    particlesVar.material.uniforms.uStartRadiusRatio = new THREE.Uniform(STREAM_START_RADIUS_RATIO)
    particlesVar.material.uniforms.uEndRadiusRatio = new THREE.Uniform(STREAM_END_RADIUS_RATIO)
    particlesVar.material.uniforms.uNeckRadiusRatio = new THREE.Uniform(STREAM_NECK_RADIUS_RATIO)
    particlesVar.material.uniforms.uPinchSharpness = new THREE.Uniform(STREAM_PINCH_SHARPNESS)
    particlesVar.material.uniforms.uRadialShellMin = new THREE.Uniform(STREAM_RADIAL_SHELL_MIN)
    particlesVar.material.uniforms.uLifetimeScaleMin = new THREE.Uniform(STREAM_LIFETIME_SCALE_MIN)
    particlesVar.material.uniforms.uLifetimeScaleMax = new THREE.Uniform(STREAM_LIFETIME_SCALE_MAX)
    particlesVar.material.uniforms.uInitialize = new THREE.Uniform(true)

    computation.init()

    const geometry = new THREE.BufferGeometry()
    geometry.setDrawRange(0, STREAM_PARTICLE_COUNT)
    geometry.setAttribute('aParticlesUv', buildParticlesUvAttribute(STREAM_TEXTURE_SIZE, STREAM_PARTICLE_COUNT))

    const material = new THREE.ShaderMaterial({
        vertexShader: streamParticlesVertexShader,
        fragmentShader: streamParticlesFragmentShader,
        uniforms: {
            uColor: new THREE.Uniform(new THREE.Color(indexPalette[sourceOrbIndex % indexPalette.length])),
            uOpacity: new THREE.Uniform(0.55),
            uPointSize: new THREE.Uniform(7.0),
            uParticlesTexture: new THREE.Uniform(),
            uResolution: new THREE.Uniform(new THREE.Vector2(
                sizes.width * sizes.pixelRatio,
                sizes.height * sizes.pixelRatio
            )),
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    })

    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    scene.add(points)

    return {
        sourceOrbIndex,
        targetOrbIndex,
        key: `${sourceOrbIndex}->${targetOrbIndex}`,
        computation,
        particlesVar,
        velocityVar,
        geometry,
        material,
        points,
        initialized: false,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic orb registry
// ─────────────────────────────────────────────────────────────────────────────
const orbInstances = new Map()   // orbIndex → orb
const nestedOrbInstances = new Map() // parentOrbIndex → nested orb
const streamInstances = new Map() // `${source}->${target}` → stream

const getStreamKey = (sourceOrbIndex, targetOrbIndex) => `${sourceOrbIndex}->${targetOrbIndex}`

function ensureOrb(idx) {
    if (!orbInstances.has(idx)) {
        orbInstances.set(idx, createOrb(idx))
    }
}

function ensureNestedOrb(parentOrbIndex, activeIndices) {
    if (getCounterpartIndex(parentOrbIndex, activeIndices) === null) return
    if (!nestedOrbInstances.has(parentOrbIndex)) {
        nestedOrbInstances.set(parentOrbIndex, createNestedOrb(parentOrbIndex, activeIndices))
    }
}

function ensureStream(sourceOrbIndex, targetOrbIndex) {
    const key = getStreamKey(sourceOrbIndex, targetOrbIndex)
    if (!streamInstances.has(key)) {
        streamInstances.set(key, createStream(sourceOrbIndex, targetOrbIndex))
    }
}

function destroyOrb(idx) {
    const orb = orbInstances.get(idx)
    if (!orb) return
    scene.remove(orb.points)
    orb.geometry.dispose()
    orb.material.dispose()
    orbInstances.delete(idx)
    destroyStreamsForOrb(idx)
    allOrbWorldOffsets.delete(idx)
    for (const key of streamSamplingDistributionCache.keys()) {
        if (key.startsWith(`${idx}:`)) {
            streamSamplingDistributionCache.delete(key)
        }
    }
    console.info(`[Orbs] destroyed orb ${idx}`)
}

function destroyNestedOrb(parentOrbIndex) {
    const nested = nestedOrbInstances.get(parentOrbIndex)
    if (!nested) return
    scene.remove(nested.points)
    nested.geometry.dispose()
    nested.material.dispose()
    nestedOrbInstances.delete(parentOrbIndex)
}

function destroyStreamByKey(key) {
    const stream = streamInstances.get(key)
    if (!stream) return
    scene.remove(stream.points)
    stream.geometry.dispose()
    stream.material.dispose()
    streamInstances.delete(key)
}

function destroyStreamsForOrb(orbIndex) {
    for (const [key, stream] of streamInstances) {
        if (stream.sourceOrbIndex === orbIndex || stream.targetOrbIndex === orbIndex) {
            destroyStreamByKey(key)
        }
    }
}

// Bootstrap own orb immediately
ensureOrb(windowIndex)
const ownOrb = orbInstances.get(windowIndex)

// ─────────────────────────────────────────────────────────────────────────────
// GUI (own-orb controls)
// ─────────────────────────────────────────────────────────────────────────────
gui.addColor(debugObject, 'particleColor')
    .onChange(() => ownOrb.material.uniforms.uColor.value.set(debugObject.particleColor))
    .name('Particle Color')

const generalSettingFolder = gui.addFolder('General Setting')
generalSettingFolder.add(ownOrb.material.uniforms.uFocus, 'value').min(0.1).max(20).step(0.1).name('Focus Distance')
generalSettingFolder.add(ownOrb.material.uniforms.uBlur,  'value').min(0).max(100).step(1).name('Blur Strength')
generalSettingFolder.add(ownOrb.material.uniforms.uFov,   'value').min(20).max(500).step(1).name('FOV Factor')

generalSettingFolder.add(debugObject, 'curlFreq').min(0).max(0.5).step(0.01).name('Curl Frequency')
    .onChange(v => {
        for (const o of orbInstances.values()) {
            const curlVariance = (((o.orbIndex * 13 + 5) % 11) / 11 - 0.5) * 0.12
            o.orbCurlFreq = Math.max(0.05, v + curlVariance)
            o.particlesVar.material.uniforms.uCurlFreq.value = o.orbCurlFreq
            o.velocityVar.material.uniforms.uCurlFreq.value  = o.orbCurlFreq
        }
    })

generalSettingFolder.add(debugObject, 'speed').min(0).max(100).step(0.1).name('Speed')
    .onChange(v => { for (const o of orbInstances.values()) { o.particlesVar.material.uniforms.uSpeed.value = v; o.velocityVar.material.uniforms.uSpeed.value = v } })

generalSettingFolder.add(debugObject, 'spinSpeed').min(0).max(3).step(0.01).name('Orb Spin Speed')
    .onChange(v => {
        for (const o of orbInstances.values()) {
            const spinVariance = (((o.orbIndex * 7 + 3) % 9) / 9 - 0.5) * 0.30
            o.orbSpinSpeed = Math.max(0.05, v + spinVariance)
            o.velocityVar.material.uniforms.uSpinSpeed.value = o.orbSpinSpeed
        }
    })

const particlesPhysicsFolder = gui.addFolder('Particles Physics')
particlesPhysicsFolder.add(debugObject, 'attraction').min(0).max(50000).step(0.01).name('Attraction')
    .onChange(v => { for (const o of orbInstances.values()) { o.velocityVar.material.uniforms.uAttraction.value = v } })
particlesPhysicsFolder.add(debugObject, 'damping').min(0).max(1).step(0.001).name('Damping')
    .onChange(v => { for (const o of orbInstances.values()) { o.velocityVar.material.uniforms.uDamping.value = v } })
particlesPhysicsFolder.add(debugObject, 'accelNoiseScale').min(0).max(100).step(0.01).name('Accel Noise Scale')
    .onChange(v => { for (const o of orbInstances.values()) { o.velocityVar.material.uniforms.uAccelNoiseScale.value = v } })

const windowMotionFolder = gui.addFolder('Window Motion Related')
windowMotionFolder.add(debugObject, 'windowResponseMin').min(0).max(0.5).step(0.001).name('Window Response Min')
    .onChange(v => { for (const o of orbInstances.values()) { o.velocityVar.material.uniforms.uWindowResponseMin.value = v } })
windowMotionFolder.add(debugObject, 'windowResponseMax').min(0).max(0.5).step(0.001).name('Window Response Max')
    .onChange(v => { for (const o of orbInstances.values()) { o.velocityVar.material.uniforms.uWindowResponseMax.value = v } })

// ─────────────────────────────────────────────────────────────────────────────
// Animate
// ─────────────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock()
let previousTime = 0
let knownActiveIndices = new Set([windowIndex])

// Smoothed camera XY — exponential decay filter applied to the raw
// pixel-derived world offset.  This irons out the integer-pixel quantization
// and OS window-move event jitter without changing the alignment math.
// CAMERA_SMOOTH_K controls responsiveness: higher = faster / tighter tracking.
// 12 gives a crisp but smooth feel; lower values (e.g. 6) are more floaty.
const CAMERA_SMOOTH_K   = 12
const smoothedCameraPos = new THREE.Vector2()   // initialised on first tick
let   cameraSmootherSeeded = false

const tick = () => {
    const elapsedTime = clock.getElapsedTime()
    const deltaTime   = Math.min(elapsedTime - previousTime, 0.05)  // clamp spike on tab resume
    previousTime = elapsedTime

    // ── 1. Compute this viewport's world-space position ──────────────────────
    const worldOffset = getViewportWorldOffset()

    // ── 2. Smooth then apply to camera ───────────────────────────────────────
    // Seed the smoother on the very first frame so there is no initial lurch.
    if (!cameraSmootherSeeded) {
        smoothedCameraPos.set(worldOffset.x, worldOffset.y)
        cameraSmootherSeeded = true
    }
    // Exponential smoothing: alpha approaches 1 as dt grows, so the camera
    // always catches up even at low frame rates.
    const alpha = 1.0 - Math.exp(-CAMERA_SMOOTH_K * deltaTime)
    smoothedCameraPos.x += (worldOffset.x - smoothedCameraPos.x) * alpha
    smoothedCameraPos.y += (worldOffset.y - smoothedCameraPos.y) * alpha

    camera.position.x = smoothedCameraPos.x
    camera.position.y = smoothedCameraPos.y
    camera.position.z = CAMERA_Z
    controls.target.set(smoothedCameraPos.x, smoothedCameraPos.y, 0)
    controls.update()

    // ── 3. Update own orb's attractor to match the smoothed camera center ────
    getOrCreateOrbWorldOffsetRef(windowIndex).set(smoothedCameraPos.x, smoothedCameraPos.y)

    // ── 4. Publish own orb's world position for other tabs ───────────────────
    publishOrbState(windowIndex, smoothedCameraPos.x, smoothedCameraPos.y)

    // ── 5. Read remote tab states ────────────────────────────────────────────
    const activeIndices = getActiveWindowIndices()
    const activeSet     = new Set(activeIndices)
    const remoteStates  = readRemoteOrbStates(windowIndex, activeIndices)

    // Create orbs for newly appeared tabs
    for (const idx of activeSet) {
        if (!knownActiveIndices.has(idx)) {
            ensureOrb(idx)
            ensureNestedOrb(idx, activeIndices)
            knownActiveIndices.add(idx)
        }
    }

    // Destroy orbs for tabs that have closed
    for (const idx of knownActiveIndices) {
        if (idx !== windowIndex && !activeSet.has(idx)) {
            destroyOrb(idx)
            destroyNestedOrb(idx)
            knownActiveIndices.delete(idx)
        }
    }

    for (const idx of knownActiveIndices) {
        if (getCounterpartIndex(idx, activeIndices) === null) {
            destroyNestedOrb(idx)
        } else {
            ensureNestedOrb(idx, activeIndices)
        }
    }

    // Maintain stream effects only when an orb has a counterpart.
    // For two tabs this creates the desired cross-links:
    // orb1 big -> orb2 small, and orb2 big -> orb1 small.
    const desiredStreamKeys = new Set()
    for (const sourceIdx of knownActiveIndices) {
        const targetIdx = getCounterpartIndex(sourceIdx, activeIndices)
        if (targetIdx === null) continue
        const key = getStreamKey(sourceIdx, targetIdx)
        desiredStreamKeys.add(key)
        ensureStream(sourceIdx, targetIdx)
    }
    for (const [key] of streamInstances) {
        if (!desiredStreamKeys.has(key)) {
            destroyStreamByKey(key)
        }
    }

    // Apply remote attractor positions
    for (const [idx, state] of remoteStates) {
        if (allOrbWorldOffsets.has(idx)) {
            allOrbWorldOffsets.get(idx).set(state.cx, state.cy)
        }
    }

    // ── 6. Step GPGPU for every live orb ─────────────────────────────────────
    for (const orb of orbInstances.values()) {
        const pv = orb.particlesVar
        const vv = orb.velocityVar

        pv.material.uniforms.uTime.value      = elapsedTime
        pv.material.uniforms.uDeltaTime.value = deltaTime
        pv.material.uniforms.uSpeed.value     = debugObject.speed
        pv.material.uniforms.uCurlFreq.value  = orb.orbCurlFreq

        vv.material.uniforms.uTime.value              = elapsedTime
        vv.material.uniforms.uDeltaTime.value         = deltaTime
        vv.material.uniforms.uSpeed.value             = debugObject.speed
        vv.material.uniforms.uCurlFreq.value          = orb.orbCurlFreq
        vv.material.uniforms.uSpinSpeed.value         = orb.orbSpinSpeed
        vv.material.uniforms.uAttraction.value        = debugObject.attraction
        vv.material.uniforms.uDamping.value           = debugObject.damping
        vv.material.uniforms.uAccelNoiseScale.value   = debugObject.accelNoiseScale
        vv.material.uniforms.uWindowResponseMin.value = debugObject.windowResponseMin
        vv.material.uniforms.uWindowResponseMax.value = debugObject.windowResponseMax
        // uCameraCenterOffset is a shared Vector2 reference — updated above

        orb.computation.compute()

        if (!orb.initialized) {
            pv.material.uniforms.uInitialize.value = false
            orb.initialized = true
        }

        orb.material.uniforms.uParticlesTexture.value =
            orb.computation.getCurrentRenderTarget(orb.particlesVar).texture
        orb.material.uniforms.uTime.value = elapsedTime
    }

    // ── 6b. Update nested-orb meshes (same simulation as parent orb) ───────
    for (const [parentIdx, nested] of nestedOrbInstances) {
        const parentOrb = orbInstances.get(parentIdx)
        if (!parentOrb) continue

        const counterpartIndex = getCounterpartIndex(parentIdx, activeIndices)
        if (nested.counterpartIndex !== counterpartIndex) {
            nested.counterpartIndex = counterpartIndex
            const colorIndex = counterpartIndex ?? parentIdx
            nested.material.uniforms.uColor.value.set(indexPalette[colorIndex % indexPalette.length])
        }

        nested.material.uniforms.uParticlesTexture.value =
            parentOrb.computation.getCurrentRenderTarget(parentOrb.particlesVar).texture
        nested.material.uniforms.uTime.value = elapsedTime
    }

    // ── 6c. Step stream particles (surface-to-surface looping flow) ─────────
    for (const stream of streamInstances.values()) {
        const sourceOrb = orbInstances.get(stream.sourceOrbIndex)
        const targetOrb = orbInstances.get(stream.targetOrbIndex)
        if (!sourceOrb || !targetOrb) continue

        const pv = stream.particlesVar

        pv.material.uniforms.uSourceParticlesTexture.value =
            sourceOrb.computation.getCurrentRenderTarget(sourceOrb.particlesVar).texture
        pv.material.uniforms.uTargetParticlesTexture.value =
            targetOrb.computation.getCurrentRenderTarget(targetOrb.particlesVar).texture
        pv.material.uniforms.uDeltaTime.value = deltaTime

        stream.computation.compute()

        if (!stream.initialized) {
            pv.material.uniforms.uInitialize.value = false
            stream.initialized = true
        }

        stream.material.uniforms.uParticlesTexture.value =
            stream.computation.getCurrentRenderTarget(stream.particlesVar).texture
    }

    // ── 7. Render ─────────────────────────────────────────────────────────────
    renderer.render(scene, camera)

    window.requestAnimationFrame(tick)
}

tick()
