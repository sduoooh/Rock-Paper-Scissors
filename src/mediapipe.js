// MediaPipe 封装：识别全部在 Web Worker 中执行
// 架构：主线程 video 正常播放 + 定时从 video 抓帧(OffscreenCanvas) transfer 给 Worker
// Worker 识别完一帧后通知主线程，主线程再调度下一帧抓取（串行，无帧堆积）

const RPS_MAP = {
  Victory: 'scissors',
  Closed_Fist: 'rock',
  Open_Palm: 'paper'
}
const THUMB_UP = 'Thumb_Up'
const THUMB_DOWN = 'Thumb_Down'

let worker = null
let workerReady = false
let readyPromise = null
let readyResolve = null
let readyReject = null

// 识别会话状态
let videoEl = null
let resultCallback = null
let captureCanvas = null
let captureCtx = null
let recognizeTimer = null
let running = false
// 识别节流默认间隔：两次抓帧间至少间隔多久（ms）
// 串行调度（识别完才抓下一帧）。训练用 300ms（降负载、减轻运动模糊），
// 游戏用 150ms（更高实时性）。可在 startRecognition 时通过 intervalMs 覆盖
const DEFAULT_RECOGNIZE_INTERVAL_MS = 300
let recognizeIntervalMs = DEFAULT_RECOGNIZE_INTERVAL_MS

function getWorker() {
  if (worker) return worker
  // 经典 Worker（非 module）：MediaPipe 的 WASM 加载器内部调用 importScripts()，
  // 该 API 仅经典 Worker 支持
  worker = new Worker(new URL('./recognizer.worker.js', import.meta.url))
  readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const onInit = (e) => {
    if (e.data.type === 'ready') {
      workerReady = true
      worker.removeEventListener('message', onInit)
      readyResolve()
    } else if (e.data.type === 'error' && !workerReady) {
      worker.removeEventListener('message', onInit)
      readyReject(new Error(e.data.message))
    }
  }
  worker.addEventListener('message', onInit)
  worker.addEventListener('message', (e) => {
    const msg = e.data
    if (msg.type === 'result') {
      const top = msg.raw
      const r = {
        ok: true,
        raw: top,
        score: msg.score || 0,
        rps: top ? RPS_MAP[top] || null : null,
        thumbUp: top === THUMB_UP,
        thumbDown: top === THUMB_DOWN,
        // worker 识别用的同一帧 ImageBitmap，供主线程截图
        // 保证识别与截图零时间差，避免"识别a记录b"的粘连
        frame: msg.frame || null
      }
      if (resultCallback) resultCallback(r)
      // 回调内若需保留 frame 应同步消费（如生成 dataURL）；
      // 回调返回后统一释放，避免 ImageBitmap 泄漏
      if (r.frame) r.frame.close()
      // 识别完成，调度下一帧抓取
      scheduleNext()
    } else if (msg.type === 'error') {
      console.error('[mp] worker error:', msg.message)
      // 出错也要继续调度，否则会卡住
      scheduleNext()
    }
  })
  worker.onerror = (e) => {
    console.error('[worker] error:', e.message, e.filename, e.lineno)
    if (!workerReady && readyReject) {
      readyReject(new Error(e.message || 'Worker 脚本加载失败'))
    }
  }
  worker.postMessage({ type: 'init' })
  return worker
}

// 加载识别器（初始化 Worker 并等待就绪）。加载页调用
export function initRecognizer() {
  if (!worker) getWorker()
  return readyPromise
}

// 启动识别会话：传入 video 元素与结果回调
// 主线程定时从 video 抓帧 transfer 给 Worker，Worker 串行识别
// intervalMs 可选：本次会话的识别间隔，不传用默认 300ms
export async function startRecognition(video, onResult, intervalMs) {
  if (!workerReady) {
    try {
      await readyPromise
    } catch (e) {
      console.error('[mp] worker not ready:', e)
      return false
    }
  }
  if (!video) {
    console.error('[mp] startRecognition: no video element')
    return false
  }
  stopRecognition()
  resultCallback = onResult
  videoEl = video
  recognizeIntervalMs = intervalMs || DEFAULT_RECOGNIZE_INTERVAL_MS

  // 初始化抓帧 canvas（优先 OffscreenCanvas，transferToImageBitmap 同步且零拷贝）
  const w = video.videoWidth || 640
  const h = video.videoHeight || 480
  if (typeof OffscreenCanvas !== 'undefined') {
    captureCanvas = new OffscreenCanvas(w, h)
  } else {
    captureCanvas = document.createElement('canvas')
    captureCanvas.width = w
    captureCanvas.height = h
  }
  captureCtx = captureCanvas.getContext('2d', { willReadFrequently: false })

  running = true
  scheduleNext()
  return true
}

function scheduleNext() {
  if (!running) return
  recognizeTimer = setTimeout(captureAndRecognize, recognizeIntervalMs)
}

// 从 video 抓取当前帧，生成 ImageBitmap transfer 给 Worker
async function captureAndRecognize() {
  if (!running) return
  const v = videoEl
  if (!v || !workerReady) {
    scheduleNext()
    return
  }
  if (v.readyState < 2 || v.videoWidth === 0) {
    // video 还没准备好，稍后重试
    scheduleNext()
    return
  }
  const w = v.videoWidth
  const h = v.videoHeight
  // 尺寸变化时重设 canvas
  if (captureCanvas.width !== w || captureCanvas.height !== h) {
    captureCanvas.width = w
    captureCanvas.height = h
  }
  // drawImage 是 GPU 加速的，非常轻量，不会阻塞 video 解码
  captureCtx.drawImage(v, 0, 0, w, h)
  // 生成 ImageBitmap 并 transfer 给 Worker
  let bitmap
  if (captureCanvas.transferToImageBitmap) {
    // OffscreenCanvas: 同步，零拷贝
    bitmap = captureCanvas.transferToImageBitmap()
  } else {
    // 普通 canvas: 异步 createImageBitmap（对 canvas 可靠，不存在 createImageBitmap(video) 的挂起问题）
    try {
      bitmap = await createImageBitmap(captureCanvas)
    } catch (e) {
      console.error('[mp] createImageBitmap failed:', e)
      scheduleNext()
      return
    }
  }
  if (!running) {
    bitmap.close()
    return
  }
  worker.postMessage({ type: 'recognize', frame: bitmap }, [bitmap])
  // 下一次抓取在 worker 返回 result 后由 result handler -> scheduleNext 调度
}

// 停止识别会话
export function stopRecognition() {
  running = false
  if (recognizeTimer) {
    clearTimeout(recognizeTimer)
    recognizeTimer = null
  }
  videoEl = null
  resultCallback = null
}
