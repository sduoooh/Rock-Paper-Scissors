<script setup>
import { ref, reactive, onUnmounted, nextTick } from 'vue'
import { startRecognition, stopRecognition } from '../mediapipe'
import { useCamera } from '../useCamera'
import { saveSnapshot } from '../store'

const emit = defineEmits(['done', 'cancel'])

const { videoRef, startCamera, stopCamera } = useCamera()

// 阶段：tip 提示 -> cam 摄像头/预览
const phase = ref('tip')

// 三个动作的批次状态
const ORDER = ['scissors', 'rock', 'paper']
const META = {
  scissors: { emoji: '✌️', label: '剪刀' },
  rock: { emoji: '✊', label: '石头' },
  paper: { emoji: '✋', label: '布' }
}
const detected = reactive({ scissors: false, rock: false, paper: false })
const batch = reactive({ scissors: null, rock: null, paper: null }) // 本次内存截图

// 跳字：opacity 过渡控制可见性，有新字样立即刷新，无新字样慢慢淡出
const jumpText = ref('')
const jumpVisible = ref(false)
let fadeTimer = null

const allDetected = () => ORDER.every((g) => detected[g])

async function onConfirm() {
  phase.value = 'cam'
  // 等待 v-else 渲染出 video 元素
  await nextTick()
  await new Promise((r) => requestAnimationFrame(r))
  await new Promise((r) => requestAnimationFrame(r))

  const result = await startCamera()
  if (!result.ok) {
    emit('cancel')
    return
  }
  // 启动识别会话：主线程定时从 video 抓帧 transfer 给 Worker，Worker 串行识别
  await startRecognition(videoRef.value, onResult)
}

// 识别结果回调
// 置信度阈值：低于此值的帧视为不可靠（残影/模糊），不更新截图
// 训练时使用较高阈值（0.8）保证截图质量；游戏识别时不考虑阈值
const SCORE_THRESHOLD = 0.8
function onResult(r) {
  if (!r.ok || !r.rps) return
  // 置信度未达阈值视为不可靠（残影/模糊），不弹字、不更新截图、不标记检测
  if (r.score < SCORE_THRESHOLD) return
  const g = r.rps
  // 跳字：立即刷新为新字样（替换旧字样），重置淡出计时
  jumpText.value = META[g].label
  jumpVisible.value = true
  if (fadeTimer) clearTimeout(fadeTimer)
  // 2s 后开始慢慢淡出（CSS opacity 过渡）
  fadeTimer = setTimeout(() => {
    jumpVisible.value = false
  }, 2000)
  // 用 worker 识别的同一帧截图（r.frame），而非 video 当前帧
  // 识别耗时 50-100ms，期间 video 已播放多帧，用 video 当前帧会导致"识别a记录b"
  if (r.frame) {
    batch[g] = captureSnapshot(r.frame)
    if (!detected[g]) detected[g] = true
  }
}

// 从 ImageBitmap 截图（worker 识别用的同一帧）
function captureSnapshot(bitmap) {
  const canvas = document.createElement('canvas')
  const w = (canvas.width = bitmap.width || 320)
  const h = (canvas.height = bitmap.height || 240)
  const ctx = canvas.getContext('2d')
  ctx.translate(w, 0)
  ctx.scale(-1, 1) // 镜像，与预览一致
  ctx.drawImage(bitmap, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.85)
}

function onRightButton() {
  if (allDetected()) {
    // 完成：写入存储（覆盖），回到欢迎页
    ORDER.forEach((g) => saveSnapshot(g, batch[g]))
    cleanup()
    emit('done')
  } else {
    // 取消：清空本次批次，回到欢迎页（不清空已存储文件）
    cleanup()
    emit('cancel')
  }
}

function cleanup() {
  stopRecognition()
  if (fadeTimer) clearTimeout(fadeTimer)
  fadeTimer = null
  stopCamera()
}

onUnmounted(cleanup)
</script>

<template>
  <div class="train">
    <!-- 聚焦提示 -->
    <div v-if="phase === 'tip'" class="overlay">
      <div class="modal">
        <p class="modal-tip">
          直接对着摄像头比划动作，<br />注意到上方显示三个 √ 后即可点击完成。
        </p>
        <button class="confirm-btn" @click="onConfirm">确认</button>
      </div>
    </div>

    <!-- 训练视图 -->
    <div v-else class="stage">
      <!-- 顶部状态栏 -->
      <div class="status-bar">
        <div class="segments">
          <div v-for="g in ORDER" :key="g" class="segment">
            <div class="emoji">{{ META[g].emoji }}</div>
            <div class="dot" :class="{ ok: detected[g] }">
              <span v-if="detected[g]">✓</span>
            </div>
          </div>
        </div>
        <button class="right-btn" :class="{ done: allDetected() }" @click="onRightButton">
          {{ allDetected() ? '完成' : '取消' }}
        </button>
      </div>

      <!-- 跳字：有新识别立即刷新，无新识别慢慢淡出 -->
      <div class="jump-wrap">
        <span class="jump-text" :class="{ visible: jumpVisible }">{{ jumpText }}</span>
      </div>

      <!-- 预览 -->
      <div class="preview-wrap">
        <video ref="videoRef" class="preview" autoplay playsinline muted></video>
      </div>
    </div>
  </div>
</template>

<style scoped>
.train {
  position: fixed;
  inset: 0;
}
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  color: #1b1f3a;
  border-radius: 20px;
  padding: 28px 32px;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
}
.modal-tip {
  font-size: 15px;
  line-height: 1.6;
  text-align: center;
}
.confirm-btn {
  padding: 11px 34px;
  border-radius: 999px;
  background: #1b1f3a;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}

.stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: hidden;
}

/* 状态栏：用 vmin 缩放，桌面端视觉不变，移动端自动缩小 */
.status-bar {
  margin-top: 2vmin;
  display: flex;
  align-items: center;
  gap: 1.5vmin;
  background: rgba(255, 255, 255, 0.08);
  padding: 1.1vmin 1.3vmin;
  border-radius: 2vmin;
  backdrop-filter: blur(6px);
}
.segments {
  display: flex;
  gap: 1.1vmin;
}
.segment {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 1.6vmin;
  padding: 0.9vmin 1.8vmin;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4vmin;
  min-width: 7vmin;
}
.emoji {
  font-size: clamp(20px, 2.9vmin, 26px);
  line-height: 1;
}
.dot {
  width: clamp(16px, 2vmin, 18px);
  height: clamp(16px, 2vmin, 18px);
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(10px, 1.3vmin, 12px);
  color: #fff;
}
.dot.ok {
  border-color: #2ecc71;
  background: #2ecc71;
  color: #fff;
}
.right-btn {
  padding: 1.1vmin 2.2vmin;
  border-radius: 1.6vmin;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: clamp(13px, 1.6vmin, 14px);
  font-weight: 600;
  white-space: nowrap;
}
.right-btn.done {
  background: #2ecc71;
}

/* 跳字：opacity 过渡，有新字样加 .visible 立即显现，移除后慢慢淡出 */
.jump-wrap {
  height: 4.4vmin;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1.1vmin;
  flex-shrink: 0;
}
.jump-text {
  font-size: clamp(24px, 3.8vmin, 34px);
  font-weight: 800;
  color: #fff;
  text-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity 1.2s ease-out;
}
.jump-text.visible {
  opacity: 1;
  transition-duration: 0.05s;
}

/* 预览 */
.preview-wrap {
  flex: 1;
  width: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 0.9vmin;
  padding: 0 1.3vmin 1.8vmin;
}
.preview {
  width: min(92vw, 900px);
  height: min(68vh, 600px);
  max-height: 100%;
  object-fit: cover;
  border-radius: 1.8vmin;
  transform: scaleX(-1);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  background: #000;
}
</style>
