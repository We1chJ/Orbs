import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GPUComputationRenderer } from 'three/examples/jsm/Addons.js'
import GUI from 'lil-gui'
import particlesVertexShader from './shaders/particles/vertex.glsl'
import particlesFragmentShader from './shaders/particles/fragment.glsl'
import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl'
import gpgpuVelocityShader from './shaders/gpgpu/velocity.glsl'
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
gui.hide()
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
debugObject.damping           = 0.25
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
const PARTICLE_COUNT = 512 * 512
const NESTED_PARTICLE_COUNT = 128 * 128
const TEXTURE_SIZE   = 512

function getRandomSpherePoint() {
    const v = new THREE.Vector3(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1)
    return v.length() > 1 ? getRandomSpherePoint() : v.normalize()
}

function buildParticlesUvAttribute() {
    const arr = new Float32Array(PARTICLE_COUNT * 2)
    for (let y = 0; y < TEXTURE_SIZE; y++) {
        for (let x = 0; x < TEXTURE_SIZE; x++) {
            const i = (y * TEXTURE_SIZE + x) * 2
            arr[i]   = x / TEXTURE_SIZE
            arr[i+1] = y / TEXTURE_SIZE
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-orb attractor positions (world units, Vector2)
// Stored by orbIndex; passed by reference into each orb's velocity shader.
// ─────────────────────────────────────────────────────────────────────────────
const allOrbWorldOffsets = new Map()   // orbIndex → THREE.Vector2

// ─────────────────────────────────────────────────────────────────────────────
// Orb factory
// ─────────────────────────────────────────────────────────────────────────────
function createOrb(orbIndex) {
    const color = indexPalette[orbIndex % indexPalette.length]

    if (!allOrbWorldOffsets.has(orbIndex)) {
        allOrbWorldOffsets.set(orbIndex, new THREE.Vector2(0, 0))
    }
    const cameraCenterOffsetRef = allOrbWorldOffsets.get(orbIndex)

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

    return { orbIndex, computation, particlesVar, velocityVar, geometry, material, points, initialized: false, orbSpinSpeed, orbCurlFreq }
}

function getCounterpartIndex(orbIndex, activeIndices) {
    for (const idx of activeIndices) {
        if (idx !== orbIndex) return idx
    }
    return null
}

function createNestedOrb(parentOrbIndex, activeIndices) {
    const parentOffsetRef = allOrbWorldOffsets.get(parentOrbIndex) || new THREE.Vector2(0, 0)
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

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic orb registry
// ─────────────────────────────────────────────────────────────────────────────
const orbInstances = new Map()   // orbIndex → orb
const nestedOrbInstances = new Map() // parentOrbIndex → nested orb

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

function destroyOrb(idx) {
    const orb = orbInstances.get(idx)
    if (!orb) return
    scene.remove(orb.points)
    orb.geometry.dispose()
    orb.material.dispose()
    orbInstances.delete(idx)
    allOrbWorldOffsets.delete(idx)
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
    if (!allOrbWorldOffsets.has(windowIndex)) {
        allOrbWorldOffsets.set(windowIndex, new THREE.Vector2())
    }
    allOrbWorldOffsets.get(windowIndex).set(smoothedCameraPos.x, smoothedCameraPos.y)

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

    // ── 7. Render ─────────────────────────────────────────────────────────────
    renderer.render(scene, camera)

    window.requestAnimationFrame(tick)
}

tick()
