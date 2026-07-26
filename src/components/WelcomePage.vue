<script setup>
import { ref, onMounted } from 'vue'
import { hasTrained } from '../store'

const emit = defineEmits(['train', 'start'])
const trained = ref(false)

onMounted(() => {
  trained.value = hasTrained()
})
</script>

<template>
  <div class="welcome">
    <h1 class="title">剪刀石头布</h1>
    <div class="actions">
      <template v-if="!trained">
        <button class="btn" @click="emit('train')">训练</button>
      </template>
      <template v-else>
        <button class="btn" @click="emit('train')">重新训练</button>
        <button class="btn primary" @click="emit('start')">开始</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 48px;
}
.title {
  font-size: 44px;
  font-weight: 800;
  letter-spacing: 6px;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}
.actions {
  display: flex;
  gap: 20px;
}
.btn {
  padding: 14px 38px;
  border-radius: 999px;
  background: #fff;
  color: #1b1f3a;
  font-size: 16px;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  transition: transform 0.12s ease;
}
.btn:active {
  transform: scale(0.96);
}
.btn.primary {
  background: #ffd24a;
}
</style>
