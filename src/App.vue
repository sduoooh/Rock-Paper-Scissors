<script setup>
import { ref } from 'vue'
import LoadingPage from './components/LoadingPage.vue'
import WelcomePage from './components/WelcomePage.vue'
import TrainPage from './components/TrainPage.vue'
import GamePage from './components/GamePage.vue'

// 视图：loading -> welcome -> train / game
const view = ref('loading')

function onReady() {
  view.value = 'welcome'
}
</script>

<template>
  <LoadingPage v-if="view === 'loading'" @ready="onReady" />
  <WelcomePage
    v-else-if="view === 'welcome'"
    @train="view = 'train'"
    @start="view = 'game'"
  />
  <TrainPage
    v-else-if="view === 'train'"
    @done="view = 'welcome'"
    @cancel="view = 'welcome'"
  />
  <GamePage
    v-else-if="view === 'game'"
    @exit="view = 'welcome'"
  />
</template>
