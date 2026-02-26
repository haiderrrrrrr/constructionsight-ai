import { useEffect, useRef } from 'react'
import {
  Engine, Scene, ArcRotateCamera, Vector3,
  HemisphericLight, DirectionalLight, Color3, Color4,
  MeshBuilder, StandardMaterial, FresnelParameters, Material,
} from '@babylonjs/core'
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader.js'
import '@babylonjs/loaders/glTF'
import { API_BASE } from '@/utils/api'

// Blender-style infinite grid: fine + coarse lines + X/Y axes
function buildGrid(scene, modelSize) {
  const half = modelSize * 6
  const fineStep = modelSize / 10
  const fineLines = []
  const coarseLines = []

  const steps = Math.ceil(half / fineStep)
  for (let i = -steps; i <= steps; i++) {
    const t = i * fineStep
    const isCoarse = Math.abs(Math.round(i % 5)) === 0
    const bucket = isCoarse ? coarseLines : fineLines
    bucket.push([new Vector3(t, 0, -half), new Vector3(t, 0, half)])
    bucket.push([new Vector3(-half, 0, t), new Vector3(half, 0, t)])
  }

  const fine = MeshBuilder.CreateLineSystem('gfine', { lines: fineLines }, scene)
  fine.color = new Color3(0.22, 0.22, 0.22)
  fine.isPickable = false
  fine.renderingGroupId = 0

  const coarse = MeshBuilder.CreateLineSystem('gcoarse', { lines: coarseLines }, scene)
  coarse.color = new Color3(0.30, 0.30, 0.30)
  coarse.isPickable = false
  coarse.renderingGroupId = 0

  // Axis lines (X = red, Z = green like Blender)
  const xAxis = MeshBuilder.CreateLineSystem('ax', {
    lines: [[new Vector3(-half, 0, 0), new Vector3(half, 0, 0)]]
  }, scene)
  xAxis.color = new Color3(0.55, 0.08, 0.08)
  xAxis.isPickable = false
  xAxis.renderingGroupId = 0

  const zAxis = MeshBuilder.CreateLineSystem('az', {
    lines: [[new Vector3(0, 0, -half), new Vector3(0, 0, half)]]
  }, scene)
  zAxis.color = new Color3(0.08, 0.42, 0.08)
  zAxis.isPickable = false
  zAxis.renderingGroupId = 0

  return { fine, coarse, xAxis, zAxis }
}

export default function BimViewer({ modelUrl }) {
  const canvasRef = useRef(null)
  const fullUrl = modelUrl ? (modelUrl.startsWith('http') ? modelUrl : `${API_BASE}${modelUrl}`) : null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Block browser page-zoom when scrolling over the canvas
    const blockPageZoom = e => e.preventDefault()
    canvas.addEventListener('wheel', blockPageZoom, { passive: false })

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
    // Manual DPR scaling — more reliable than adaptToDeviceRatio option
    engine.setHardwareScalingLevel(1 / window.devicePixelRatio)

    const scene = new Scene(engine)
    scene.clearColor = new Color4(0.224, 0.224, 0.224, 1)   // #393939

    // Disable Babylon's tone mapping & image processing so colours match
    // exactly what was set in Blender (linear, no filmic curve applied)
    scene.imageProcessingConfiguration.isEnabled = false

    // ArcRotateCamera — Blender orbit feel
    const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.5, 10, Vector3.Zero(), scene)
    camera.attachControl(canvas, true)
    camera.useNaturalPinchZoom = true
    camera.wheelPrecision = 10
    camera.pinchPrecision = 5
    camera.lowerRadiusLimit = 0.001
    camera.upperRadiusLimit = 10000000
    camera.panningSensibility = 100
    camera.minZ = 0.001
    camera.maxZ = 10000000

    // Lighting
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
    hemi.intensity = 1.0
    hemi.diffuse = new Color3(1, 1, 1)
    hemi.groundColor = new Color3(0.2, 0.2, 0.2)
    const dir = new DirectionalLight('dir', new Vector3(-0.5, -1, -0.5), scene)
    dir.intensity = 0.8

    // Initial placeholder grid
    let gridMeshes = buildGrid(scene, 10)

    if (!fullUrl) return
    SceneLoader.ImportMeshAsync('', fullUrl, undefined, scene).then(result => {
      const meshes = result.meshes.filter(m => m.getTotalVertices() > 0)
      if (meshes.length === 0) return

      const solidXray = new StandardMaterial('solid-xray', scene)
      solidXray.diffuseColor = new Color3(0.72, 0.72, 0.72)
      solidXray.emissiveColor = new Color3(0.72, 0.72, 0.72)
      solidXray.specularColor = new Color3(0, 0, 0)
      solidXray.alpha = 0.32
      solidXray.backFaceCulling = false
      solidXray.separateCullingPass = true
      solidXray.transparencyMode = Material.MATERIAL_ALPHABLEND
      solidXray.opacityFresnelParameters = new FresnelParameters()
      solidXray.opacityFresnelParameters.bias = 0.12
      solidXray.opacityFresnelParameters.power = 2.2
      solidXray.opacityFresnelParameters.leftColor = new Color3(0.04, 0.04, 0.04)
      solidXray.opacityFresnelParameters.rightColor = new Color3(0.28, 0.28, 0.28)
      solidXray.disableLighting = true
      solidXray.disableDepthWrite = true

      const baseXray = new StandardMaterial('base-xray', scene)
      baseXray.diffuseColor = new Color3(0.62, 0.62, 0.62)
      baseXray.emissiveColor = new Color3(0.62, 0.62, 0.62)
      baseXray.specularColor = new Color3(0, 0, 0)
      baseXray.alpha = 0.22
      baseXray.backFaceCulling = false
      baseXray.separateCullingPass = true
      baseXray.transparencyMode = Material.MATERIAL_ALPHABLEND
      baseXray.opacityFresnelParameters = new FresnelParameters()
      baseXray.opacityFresnelParameters.bias = 0.10
      baseXray.opacityFresnelParameters.power = 2.2
      baseXray.opacityFresnelParameters.leftColor = new Color3(0.03, 0.03, 0.03)
      baseXray.opacityFresnelParameters.rightColor = new Color3(0.22, 0.22, 0.22)
      baseXray.disableLighting = true
      baseXray.disableDepthWrite = true

      const min = new Vector3(Infinity, Infinity, Infinity)
      const max = new Vector3(-Infinity, -Infinity, -Infinity)
      meshes.forEach(m => {
        const b = m.getHierarchyBoundingVectors(true)
        Vector3.CheckExtends(b.min, min, max)
        Vector3.CheckExtends(b.max, min, max)
      })

      const center = Vector3.Center(min, max)
      const size = max.subtract(min)
      const maxDim = Math.max(size.x, size.y, size.z) || 1

      let baseMesh = null
      let baseVolume = -Infinity
      meshes.forEach(m => {
        const b = m.getHierarchyBoundingVectors(true)
        const s = b.max.subtract(b.min)
        const v = (s.x || 0) * (s.y || 0) * (s.z || 0)
        if (v > baseVolume) {
          baseVolume = v
          baseMesh = m
        }
      })

      // Tight fit — model fills viewport like Blender's numpad-dot
      camera.target = center
      camera.radius = maxDim * 0.92
      camera.lowerRadiusLimit = maxDim * 0.0001
      camera.upperRadiusLimit = maxDim * 200
      // Scale wheel speed proportional to model — feels natural at any scale
      camera.wheelPrecision = 200 / maxDim

      // Rebuild grid proportional to model, floor at model bottom
      Object.values(gridMeshes).forEach(m => m.dispose())
      gridMeshes = buildGrid(scene, maxDim)
      Object.values(gridMeshes).forEach(m => { m.position.y = min.y })

      meshes.forEach(m => {
        m.material = (baseMesh && m === baseMesh) ? baseXray : solidXray
        m.renderingGroupId = 1
        m.enableEdgesRendering()
        m.edgesWidth = (baseMesh && m === baseMesh) ? 0.7 : 0.75
        m.edgesColor = (baseMesh && m === baseMesh)
          ? new Color4(0.22, 0.22, 0.22, 0.16)
          : new Color4(0.18, 0.18, 0.18, 0.24)
      })
    }).catch(err => console.error('[BimViewer]', err))

    engine.runRenderLoop(() => scene.render())

    const onResize = () => {
      engine.setHardwareScalingLevel(1 / window.devicePixelRatio)
      engine.resize()
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('wheel', blockPageZoom)
      engine.dispose()
    }
  }, [fullUrl])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', borderRadius: 12, outline: 'none', background: '#393939' }}
    />
  )
}
