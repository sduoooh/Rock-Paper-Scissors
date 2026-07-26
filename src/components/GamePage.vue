<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { startRecognition, stopRecognition } from '../mediapipe'
import { useCamera } from '../useCamera'
import { getSnapshot } from '../store'

const emit = defineEmits(['exit'])

const { videoRef, startCamera, stopCamera } = useCamera()

// 状态机：ready 等待拇指上 -> playing 动画中 -> result 结果等待拇指
const state = ref('ready')
const popup = ref('') // 弹窗文本
const leftImage = ref('') // 左侧截图（电脑出招）

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
  await startRecognition(videoRef.value, onResult)
})

// 识别结果回调：根据当前状态分发
function onResult(r) {
  if (!r.ok) return
  if (state.value === 'ready') {
    if (r.thumbUp) {
      popup.value = ''
      beginRound()
    }
  } else if (state.value === 'playing') {
    // 动画进行中：缓存识别结果，最后一帧定格时使用
    if (r.rps) pendingRps = r.rps
  } else if (state.value === 'result') {
    if (r.thumbDown) {
      restartRound()
    } else if (r.thumbUp) {
      cleanup()
      emit('exit')
    }
  }
}

async function beginRound() {
  if (running) return
  running = true
  state.value = 'playing'
  popup.value = ''
  leftImage.value = ''
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
  if (!res.rps) {
    state.value = 'result'
    popup.value = '你出太慢了！'
    return
  }
  const player = res.rps
  const rand = Math.random() * 3
  const opp = rand < 1 ? 'scissors' : rand < 2 ? 'rock' : 'paper'
  leftImage.value = getSnapshot(opp)
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
  stopRecognition()
  stopCamera()
}

onUnmounted(cleanup)
</script>

<template>
  <div class="game">
    <div class="arena">
      <div class="view left" :style="leftStyle">
        <img v-if="leftImage" :src="leftImage" class="fill" alt="opp" />
        <div v-else class="black"></div>
      </div>
      <div class="view right" :style="rightStyle">
        <video ref="videoRef" class="fill" autoplay playsinline muted></video>
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
  align-items: center;
  justify-content: center;
  gap: 0;
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
