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

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 收房租` : '收房租'
})

export default router
