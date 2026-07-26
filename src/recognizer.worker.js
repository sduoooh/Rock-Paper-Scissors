// MediaPipe 识别 Worker —— 经典 Worker（非 module）
// MediaPipe 的 WASM 加载器（vision_wasm_internal.js）内部调用 importScripts()，
// 该 API 仅经典 Worker 支持。故此处不能用 ES module import，须用 importScripts。
// vision_bundle 是 CommonJS 构建，用 module/exports shim 在经典 Worker 中加载。
// 本地加载：CDN 的 .cjs 文件以 application/node MIME 提供，浏览器拒绝 importScripts；
// 且本地加载避免 CDN 可用性、CORS、模型权重二次下载等问题。

// CJS 环境 shim：vision_bundle 顶部会 Object.defineProperty(exports, ...)
// 必须挂到 self（Worker 全局作用域），不能用 var 声明：
// Vite build 会把 Worker 代码包在 IIFE 中，var 声明变成局部变量，
// importScripts 加载的 vision_bundle.js 在全局作用域执行时找不到 module/exports。
self.module = { exports: {} }
self.exports = self.module.exports
// 相对路径：基准是 Worker 脚本自身 URL。
// dev: /src/recognizer.worker.js -> ../mediapipe/ = /mediapipe/
// build(GitHub Pages): /Rock-Paper-Scissors/assets/recognizer.worker-xxxx.js -> ../mediapipe/ = /Rock-Paper-Scissors/mediapipe/
importScripts('../mediapipe/vision_bundle.js')
var FilesetResolver = self.module.exports.FilesetResolver
var GestureRecognizer = self.module.exports.GestureRecognizer

// WASM 加载器文件（vision_wasm_internal.js 等）也已放在 public/mediapipe/ 本地：
// vision_bundle 内部会用 importScripts() 加载它们，从 CDN 拉取会因网络/CORS 失败，必须本地。
var WASM_BASE = '../mediapipe'
// 模型权重文件也本地化：官方 googleapis.com 在国内网络被阻断（Connection reset），
// 无法 fetch。需手动下载 gesture_recognizer.task 放到 public/mediapipe/ 下。
var MODEL_URL = '../mediapipe/gesture_recognizer.task'

var recognizer = null
var lastTs = 0

function nextTs() {
  var now = performance.now()
  if (now <= lastTs) lastTs += 1
  else lastTs = now
  return lastTs
}

async function init() {
  var vision = await FilesetResolver.forVisionTasks(WASM_BASE)
  // Worker 中无 WebGL 上下文（无 canvas），GPU delegate 依赖 OffscreenCanvas+WebGL，
  // 不可用且失败是异步的无法 try/catch，会卡死。直接用 CPU delegate。
  // 模型含 CPU only ops，GPU 也会回退 XNNPACK，CPU 无性能损失。
  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    numHands: 1,
    runningMode: 'VIDEO'
  })
  postMessage({ type: 'ready' })
}

async function doRecognize(frame) {
  var ts = nextTs()
  var res
  try {
    // ImageBitmap 可直接作为 recognizeForVideo 的输入（CanvasImageSource）
    res = recognizer.recognizeForVideo(frame, ts)
  } catch (e) {
    // 识别出错：关闭 frame 避免泄漏
    frame.close()
    throw e
  }
  var cats = (res && res.gestures && res.gestures[0]) || []
  var top = null
  var topScore = -1
  for (var i = 0; i < cats.length; i++) {
    var c = cats[i]
    if (c.score > topScore) {
      topScore = c.score
      top = c.categoryName
    }
  }
  // topScore 为置信度（0~1），主线程可据此决定是否替换例图（避免残影帧覆盖高质量截图）
  // 注意：判断条件须用 topScore（数字），不能用 top（字符串），否则字符串>=0 恒为 false
  // frame 不 close，transfer 回主线程：供主线程截图，保证识别与截图用的是同一帧
  // 否则主线程回调里抓 video 当前帧会与识别帧存在时间差，导致"识别a记录b"的粘连问题
  postMessage({ type: 'result', raw: top, score: topScore >= 0 ? topScore : 0, frame: frame }, [frame])
}

self.onmessage = async function (e) {
  var msg = e.data
  if (msg.type === 'init') {
    try {
      await init()
    } catch (err) {
      postMessage({ type: 'error', message: String((err && err.stack) || err) })
    }
  } else if (msg.type === 'recognize') {
    if (!recognizer) {
      // recognizer 未就绪，关闭帧避免泄漏
      if (msg.frame && msg.frame.close) msg.frame.close()
      return
    }
    try {
      await doRecognize(msg.frame)
    } catch (err) {
      postMessage({ type: 'error', message: String((err && err.stack) || err) })
      // 出错也要通知主线程继续 pump，否则会卡住
      postMessage({ type: 'result', raw: null })
    }
  }
}
