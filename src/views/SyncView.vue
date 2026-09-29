<script setup lang="ts">
import { computed, reactive } from 'vue'
import { showToast } from 'vant'

import { useSyncStore, type SyncConfig } from '@/stores/sync'
import { formatDateTime } from '@/utils/format'

const store = useSyncStore()

const form = reactive<SyncConfig>({ ...store.config })

const formValid = computed(
  () =>
    Boolean(
      form.owner.trim() &&
        form.repo.trim() &&
        form.branch.trim() &&
        form.path.trim() &&
        form.token.trim()
    )
)

const lastSyncText = computed(() =>
  store.lastSyncAt ? formatDateTime(store.lastSyncAt) : '从未同步'
)

function saveConfig(): void {
  if (!formValid.value) {
    showToast('请完整填写 GitHub 配置和 Token')
    return
  }
  store.updateConfig({
    owner: form.owner.trim(),
    repo: form.repo.trim(),
    branch: form.branch.trim() || 'main',
    path: form.path.trim() || 'data/records.json',
    token: form.token.trim(),
    autoPush: form.autoPush
  })
  showToast('配置已保存')
}

async function onSync(): Promise<void> {
  try {
    await store.sync()
    showToast('同步成功')
  } catch {
    // 错误信息已显示在页面顶部 NoticeBar
  }
}
</script>

<template>
  <div class="page">
    <header class="app-header">
      <div class="header-title">
        <span class="title-emoji">☁️</span>
        <span>云同步</span>
      </div>
      <div class="header-sub">
        <van-tag :type="store.configured ? 'success' : 'warning'" size="large" round>
          {{ store.configured ? '已配置 GitHub 仓库' : '未配置' }}
        </van-tag>
      </div>
    </header>

    <main class="sync-body">
      <van-notice-bar
        v-if="store.lastError"
        class="error-bar"
        color="#ee0a24"
        background="#fff1f0"
        left-icon="warning-o"
        wrapable
        :text="store.lastError"
      />

      <section class="sync-card guide-card">
        <h2 class="card-heading">免费云端存储：GitHub 私有仓库</h2>
        <ol class="guide-steps">
          <li>
            在 GitHub 新建一个<b>私有仓库</b>专门存数据（例如
            <code>rent-data</code>，不必是部署网页的那个仓库）；
          </li>
          <li>
            创建 Fine-grained Token：
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener"
            >
              github.com/settings/personal-access-tokens/new
              <van-icon name="link-o" />
            </a>
            ，Repository access 只勾选该仓库，权限选 <b>Contents → Read and write</b>；
          </li>
          <li>在下方填入用户名 / 仓库名 / Token 并保存，然后点击「立即同步」。</li>
        </ol>
        <p class="guide-tip">
          🔒 Token 只保存在你本机浏览器（localStorage），不会写进网页代码；
          数据文件存在你自己的私有仓库里，完全免费。
        </p>
      </section>

      <van-cell-group inset class="form-card">
        <div class="card-title">GitHub 配置</div>
        <van-field
          v-model="form.owner"
          label="用户名"
          placeholder="如：octocat"
          clearable
        />
        <van-field
          v-model="form.repo"
          label="仓库名"
          placeholder="如：rent-data（建议私有）"
          clearable
        />
        <van-field v-model="form.branch" label="分支" placeholder="main" clearable />
        <van-field
          v-model="form.path"
          label="文件路径"
          placeholder="data/records.json"
          clearable
        />
        <van-field
          v-model="form.token"
          type="password"
          label="Token"
          placeholder="fine-grained PAT"
          clearable
        />
        <van-cell center title="修改后自动同步">
          <template #right-icon>
            <van-switch v-model="form.autoPush" size="22px" :disabled="!formValid" />
          </template>
        </van-cell>
        <div class="card-actions">
          <van-button round block type="primary" @click="saveConfig">保存配置</van-button>
        </div>
      </van-cell-group>

      <section class="sync-card action-card">
        <div class="sync-status">
          <span class="status-label">上次同步</span>
          <span class="status-value">{{ lastSyncText }}</span>
        </div>
        <van-button
          round
          block
          type="primary"
          :loading="store.syncing"
          :disabled="!store.configured"
          loading-text="同步中..."
          @click="onSync"
        >
          立即同步（云端 ⇄ 本机合并）
        </van-button>
        <div class="auto-rules">
          <div class="rule-item">📥 打开网页时自动从云端拉取最新数据</div>
          <div class="rule-item">📤 新增 / 修改 / 删除 / 标记收款后自动上传（需开启下方开关）</div>
          <div class="rule-item">🔄 切回页面自动刷新云端（5 分钟节流）</div>
          <div class="rule-item">🤝 多设备按「最后修改时间」自动合并，删除也会同步</div>
        </div>
        <p class="action-tip">
          云端与本机按「最后修改时间」自动合并，双方独有的记录都会保留；
          在新手机 / 新浏览器上填好同一配置即可自动恢复全部数据。
        </p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-header {
  padding: 22px 16px 24px;
  color: #fff;
  background: linear-gradient(160deg, #0ba360, #3cba92);
  border-radius: 0 0 26px 26px;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
}

.title-emoji {
  font-size: 20px;
}

.header-sub {
  margin-top: 10px;
}

.sync-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 12px;
}

.error-bar {
  border-radius: 10px;
}

.sync-card {
  background: #fff;
  border-radius: var(--card-radius);
  padding: 16px;
  box-shadow: 0 2px 10px rgba(31, 45, 61, 0.05);
}

.card-heading {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 700;
}

.guide-steps {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--text-main);
}

.guide-steps code {
  padding: 1px 5px;
  border-radius: 4px;
  background: #f0f2f5;
  font-size: 12px;
}

.guide-steps a {
  color: var(--app-primary);
  word-break: break-all;
}

.guide-tip {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f6ffed;
  color: #389e0d;
  font-size: 12px;
  line-height: 1.7;
}

.form-card {
  margin: 0;
}

.card-title {
  padding: 14px 16px 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-sub);
}

.card-actions {
  padding: 12px 16px 16px;
}

.action-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sync-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-label {
  font-size: 13px;
  color: var(--text-sub);
}

.status-value {
  font-size: 13px;
  font-weight: 700;
}

.action-tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-sub);
}

.auto-rules {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f7f8fa;
}

.rule-item {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-main);
}
</style>
