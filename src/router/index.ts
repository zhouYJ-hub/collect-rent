import { createRouter, createWebHashHistory } from 'vue-router'

import HomeView from '@/views/HomeView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    showTabbar?: boolean
  }
}

const router = createRouter({
  // hash 路由：GitHub Pages 刷新不会 404
  history: createWebHashHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { title: '收房租', showTabbar: true }
    },
    {
      path: '/stats',
      name: 'stats',
      component: () => import('@/views/StatsView.vue'),
      meta: { title: '统计', showTabbar: true }
    },
    {
      path: '/sync',
      name: 'sync',
      component: () => import('@/views/SyncView.vue'),
      meta: { title: '云同步', showTabbar: true }
    },
    {
      path: '/edit/:id?',
      name: 'edit',
      component: () => import('@/views/RecordFormView.vue'),
      meta: { title: '记一笔' }
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]
})

// 部署更新后，旧缓存页面引用的懒加载资源可能已 404；
// 捕获后自动带参刷新一次，让浏览器获取最新 index.html 与资源
router.onError((error) => {
  const message = error instanceof Error ? error.message : String(error)
  if (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  ) {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('_r')) {
      url.searchParams.set('_r', String(Date.now()))
      window.location.replace(url.toString())
    }
  }
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 收房租` : '收房租'
})

export default router
