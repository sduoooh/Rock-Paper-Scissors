<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { startRecognition, stopRecognition } from '../mediapipe'
import { useCamera } from '../useCamera'
import { getSnapshot } from '../store'
import { META } from '../gestureMeta'

const emit = defineEmits(['exit'])

const { videoRef, startCamera, stopCamera } = useCamera()

// 状态机：ready 等待拇指上 -> playing 动画中 -> result 结果等待拇指
const state = ref('ready')
const popup = ref('') // 弹窗文本
const leftImage = ref('') // 左侧截图（电脑出招）
const leftLabel = ref('') // 左侧截图对应的手势名（与右侧识别跳字对称）

// 右侧识别跳字：复用训练页逻辑，有新识别立即刷新，无新识别慢慢淡出
const jumpText = ref('')
const jumpVisible = ref(false)
let fadeTimer = null

const leftStyle = ref({})
const rightStyle = ref({})

const OUT = 130
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let running = false
// 定格识别时缓存的最近一帧结果，供 beginRound 最后一帧使用
let pendingRps = null

onMounted(async () => {
  const result = await startCamera()
  if (!result.ok) {
    emit('exit')
    return
  }
  popup.value = '如果准备好开始，就比划“竖大拇指”'
  state.value = 'ready'
  // 启动识别会话：主线程定时从 video 抓帧 transfer 给 Worker，Worker 串行识别
  // 游戏需更高实时性，识别间隔用 150ms（训练用默认 300ms）
  await startRecognition(videoRef.value, onResult, 150)
})

// 跳字刷新：立即显现新字样，2s 后慢慢淡出
function flashJump(label) {
  jumpText.value = label
  jumpVisible.value = true
  if (fadeTimer) clearTimeout(fadeTimer)
  fadeTimer = setTimeout(() => {
    jumpVisible.value = false
  }, 2000)
}

// 识别结果回调：根据当前状态分发
function onResult(r) {
  if (!r.ok) return
  // 游戏识别不考虑置信度阈值：只要识别到 RPS 手势就弹字
  if (r.rps) flashJump(META[r.rps].label)
  if (state.value === 'ready') {
    if (r.thumbUp) {
      popup.value = ''
      beginRound()
    }
  } else if (state.value === 'playing') {
    // 动画进行中：缓存识别结果，最后一帧定格时使用
    if (r.rps) pendingRps = r.rps
  } else if (state.value === 'result') {
    // result 状态：拇指上（继续）/拇指下（再来一局）均可触发下一局
    if (r.thumbUp || r.thumbDown) {
      restartRound()
    }
  }
}

async function beginRound() {
  if (running) return
  running = true
  state.value = 'playing'
  popup.value = ''
  leftImage.value = ''
  leftLabel.value = ''
  // 重置跳字，避免上一局残留
  jumpVisible.value = false
  if (fadeTimer) clearTimeout(fadeTimer)
  pendingRps = null
  const v = videoRef.value
  if (v.paused) {
    try {
      await v.play()
    } catch (e) {
      /* ignore */
    }
  }
  for (let i = 0; i < 3; i++) {
    const isLast = i === 2
    // 向外 0.5s
    leftStyle.value = {
      transform: `translateX(${-OUT}px)`,
      transition: 'transform 500ms ease-out'
    }
    rightStyle.value = {
      transform: `translateX(${OUT}px)`,
      transition: 'transform 500ms ease-out'
    }
    await wait(510)
    // 向内 0.5s 带回弹
    leftStyle.value = {
      transform: 'translateX(0)',
      transition: 'transform 500ms cubic-bezier(0.34,1.56,0.64,1)'
    }
    rightStyle.value = {
      transform: 'translateX(0)',
      transition: 'transform 500ms cubic-bezier(0.34,1.56,0.64,1)'
    }
    await wait(510)
    if (isLast) {
      // 动画定格（视图居中停止），使用动画过程中缓存的识别结果
      // 不暂停 video：result 状态需持续识别 Thumb_Up/Thumb_Down
      handleResult({ rps: pendingRps })
      running = false
      return
    }
  }
  running = false
}

function handleResult(res) {
  // 电脑随机出招，无论玩家是否出招都展示其截图（避免黑屏）
  const rand = Math.random() * 3
  const opp = rand < 1 ? 'scissors' : rand < 2 ? 'rock' : 'paper'
  leftImage.value = getSnapshot(opp)
  // 左侧 label 与电脑出招对应，与右侧识别跳字对称
  leftLabel.value = META[opp].label
  if (!res.rps) {
    state.value = 'result'
    popup.value = '你出太慢了！'
    return
  }
  const player = res.rps
  // 规则：剪刀克布、布克石头、石头克剪刀
  const beats = { scissors: 'paper', paper: 'rock', rock: 'scissors' }
  let outcome
  if (player === opp) outcome = 'tie'
  else if (beats[player] === opp) outcome = 'win'
  else outcome = 'lose'
  const msg = {
    win: '运气好罢了。',
    tie: '敢不敢再来一次？',
    lose: '菜就多练。'
  }[outcome]
  state.value = 'result'
  popup.value = msg
}

async function restartRound() {
  popup.value = ''
  await beginRound()
}

function cleanup() {
  running = false
  if (fadeTimer) clearTimeout(fadeTimer)
  fadeTimer = null
  stopRecognition()
  stopCamera()
}

onUnmounted(cleanup)
</script>

<template>
  <div class="game">
    <div class="arena">
      <div class="view-col">
        <span class="side-label">{{ leftLabel }}</span>
        <div class="view left" :style="leftStyle">
          <img v-if="leftImage" :src="leftImage" class="fill" alt="opp" />
          <div v-else class="black"></div>
        </div>
      </div>
      <div class="view-col">
        <!-- 右侧识别跳字：与左侧 label 对称，位于右侧视图上方 -->
        <div class="jump-wrap">
          <span class="jump-text" :class="{ visible: jumpVisible }">{{ jumpText }}</span>
        </div>
        <div class="view right" :style="rightStyle">
          <video ref="videoRef" class="fill" autoplay playsinline muted></video>
        </div>
      </div>
    </div>

    <transition name="fade">
      <div v-if="popup" class="popup">
        <div class="popup-card">{{ popup }}</div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.game {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.arena {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 0;
}
.view-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8vmin;
}
/* 左侧手势名 label 与右侧识别跳字等高对齐 */
.side-label,
.jump-wrap {
  height: 4vmin;
  line-height: 4vmin;
  flex-shrink: 0;
}
.side-label {
  font-size: clamp(18px, 2.6vmin, 22px);
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
/* 右侧识别跳字：opacity 过渡，有新字样立即显现，无新字样慢慢淡出 */
.jump-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}
.jump-text {
  font-size: clamp(18px, 2.6vmin, 22px);
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 1.2s ease-out;
}
.jump-text.visible {
  opacity: 1;
  transition-duration: 0.05s;
}
.view {
  width: 42vmin;
  height: 56vmin;
  overflow: hidden;
  background: #000;
}
.view.left {
  border-radius: 16px 0 0 16px;
}
.view.right {
  border-radius: 0 16px 16px 0;
}
.fill {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.black {
  width: 100%;
  height: 100%;
  background: #000;
}
.view.right .fill {
  transform: scaleX(-1);
}

.popup {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
  pointer-events: none;
}
.popup-card {
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  padding: 18px 30px;
  border-radius: 16px;
  font-size: 18px;
  font-weight: 600;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.4);
  text-align: center;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
