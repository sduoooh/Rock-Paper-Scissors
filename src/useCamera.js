// 摄像头 composable：统一 getUserMedia、video 就绪等待、流清理逻辑
// TrainPage 与 GamePage 共用，避免重复实现与约束不一致
import { ref, onUnmounted } from 'vue'

const CONSTRAINTS = {
  video: {
    facingMode: 'user',
    // 不限制分辨率：让摄像头给原始分辨率，识别器直接用全分辨率帧
    // 细节更丰富，对手指张开度敏感的"布"等手势识别更可靠
    frameRate: { ideal: 15, max: 24 }
  },
  audio: false
}

// 轮询 + 事件双通道等待 video 拿到有效帧
function waitForVideoReady(v, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const start = performance.now()
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(ok)
    }
    const isReady = () => v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0
    const onReady = () => {
      if (isReady()) done(true)
    }
    v.addEventListener('loadeddata', onReady)
    v.addEventListener('playing', onReady)
    v.addEventListener('canplay', onReady)
    v.addEventListener('error', onError, { once: true })
    function onError() {
      done(false)
    }
    function cleanup() {
      v.removeEventListener('loadeddata', onReady)
      v.removeEventListener('playing', onReady)
      v.removeEventListener('canplay', onReady)
      v.removeEventListener('error', onError)
    }
    const check = () => {
      if (settled) return
      if (isReady()) return done(true)
      if (performance.now() - start > timeoutMs) return done(false)
      requestAnimationFrame(check)
    }
    check()
  })
}

export function useCamera() {
  const videoRef = ref(null)
  const stream = ref(null)
  const track = ref(null)

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, reason: 'unsupported' }
    }
    let s
    try {
      s = await navigator.mediaDevices.getUserMedia(CONSTRAINTS)
    } catch (e) {
      return { ok: false, reason: e.name }
    }
    const v = videoRef.value
    if (!v) {
      s.getTracks().forEach((t) => t.stop())
      return { ok: false, reason: 'no-video' }
    }
    stream.value = s
    track.value = s.getVideoTracks()[0] || null
    v.muted = true
    v.playsInline = true
    v.srcObject = s
    const pp = v.play()
    if (pp && typeof pp.catch === 'function') pp.catch(() => {})
    const ready = await waitForVideoReady(v, 10000)
    if (!ready) {
      stopCamera()
      return { ok: false, reason: 'timeout' }
    }
    return { ok: true }
  }

  function stopCamera() {
    if (stream.value) {
      stream.value.getTracks().forEach((t) => t.stop())
      stream.value = null
    }
    track.value = null
  }

  onUnmounted(stopCamera)

  return { videoRef, stream, track, startCamera, stopCamera }
}
