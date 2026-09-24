<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const showTabbar = computed(() => route.meta.showTabbar === true)
</script>

<template>
  <div class="app-shell">
    <router-view v-slot="{ Component }">
      <transition name="page-fade" mode="out-in">
        <component :is="Component" :key="route.fullPath" />
      </transition>
    </router-view>

    <van-tabbar
      v-if="showTabbar"
      route
      placeholder
      safe-area-inset-bottom
      class="app-tabbar"
    >
      <van-tabbar-item to="/" icon="notes-o">记录</van-tabbar-item>
      <van-tabbar-item to="/stats" icon="bar-chart-o">统计</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.app-tabbar {
  max-width: 640px;
  left: 50%;
  transform: translateX(-50%);
}
</style>

