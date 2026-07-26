<script setup>
import { ref, onMounted } from 'vue'
import { initRecognizer } from '../mediapipe'

const emit = defineEmits(['ready'])

const loading = ref(true)
const errorTitle = ref('')
const errorDesc = ref('')

async function run() {
  loading.value = true
  errorTitle.value = ''
  errorDesc.value = ''
  try {
    // 初始化 Worker 并等待就绪（加载 WASM 与模型权重，仅一次）
    await initRecognizer()
    // 用 Permissions API 检查摄像头权限状态（不实际启动流，避免设备状态异常）
    if (navigator.permissions) {
      try {
        const p = await navigator.permissions.query({ name: 'camera' })
        if (p.state === 'denied') {
          throw new Error('CAMERA')
        }
      } catch (e) {
        // Permissions API 不支持时忽略，后续 getUserMedia 会再次校验
      }
    }
    emit('ready')
  } catch (e) {
    console.error('[loading] initRecognizer 失败:', e)
    if (e && e.message === 'CAMERA') {
      errorTitle.value = ''
      errorDesc.value = '请提供摄像头权限'
    } else {
      errorTitle.value = 'Oops！'
      // 透传具体错误信息，便于诊断（CDN/WASM/模型加载、GPU delegate 等）
      errorDesc.value = '加载核心组件 MediaPipe 失败：' + (e?.message || '未知错误')
    }
    loading.value = false
  }
}

onMounted(run)
</script>

<template>
  <div class="loading">
    <template v-if="loading">
      <div class="spinner"></div>
      <div class="tip">正在加载...</div>
    </template>
    <template v-else>
      <div v-if="errorTitle" class="err-title">{{ errorTitle }}</div>
      <div class="err-desc">{{ errorDesc }}</div>
      <button class="retry" @click="run">重试</button>
    </template>
  </div>
</template>

<style scoped>
.loading {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.tip {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.85);
}
.err-title {
  font-size: 22px;
  font-weight: 800;
}
.err-desc {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.8);
  max-width: 320px;
  text-align: center;
  line-height: 1.5;
}
.retry {
  margin-top: 8px;
  padding: 10px 24px;
  border-radius: 24px;
  background: #fff;
  color: #1b1f3a;
  font-weight: 600;
  font-size: 14px;
}
</style>
