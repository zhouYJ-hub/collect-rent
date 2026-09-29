<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'

import { useRentStore } from '@/stores/rent'
import { useSyncStore } from '@/stores/sync'
import { FEE_META, recordTotal, type FeeMeta, type RentRecord } from '@/types'
import { buildBillText } from '@/utils/bill'
import { copyText } from '@/utils/clipboard'
import { formatYuan } from '@/utils/format'

const router = useRouter()
const store = useRentStore()
const syncStore = useSyncStore()

const syncStatusText = computed(() => {
  if (!syncStore.configured) return '本地'
  if (syncStore.syncing) return '同步中'
  if (!syncStore.lastSyncAt) return '未同步'
  const date = new Date(syncStore.lastSyncAt)
  const now = new Date()
  const hm = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay ? `已同步 ${hm}` : `已同步 ${date.getMonth() + 1}/${date.getDate()} ${hm}`
})

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth() + 1)

const isCurrentMonth = computed(
  () => year.value === now.getFullYear() && month.value === now.getMonth() + 1
)

const list = computed(() => store.recordsOfMonth(year.value, month.value))
const summary = computed(() => store.monthSummary(year.value, month.value))

function prevMonth(): void {
  if (month.value === 1) {
    year.value -= 1
    month.value = 12
  } else {
    month.value -= 1
  }
}

function nextMonth(): void {
  if (month.value === 12) {
    year.value += 1
    month.value = 1
  } else {
    month.value += 1
  }
}

function goToday(): void {
  year.value = now.getFullYear()
  month.value = now.getMonth() + 1
}

function goAdd(): void {
  router.push({ name: 'edit' })
}

function onCardClick(record: RentRecord): void {
  router.push({ name: 'edit', params: { id: record.id } })
}

function onTogglePaid(record: RentRecord): void {
  store.togglePaid(record.id)
  showToast(record.paid ? '已标记为未收' : '已标记为已收')
}

/* ===== 分享账单给租客 ===== */

const showSharePopup = ref(false)
const shareText = ref('')

type ShareCapableNavigator = Navigator & {
  share?: (data: { title?: string; text?: string }) => Promise<void>
}

const canNativeShare = computed(() => {
  const nav = navigator as ShareCapableNavigator
  return typeof nav.share === 'function'
})

async function onShare(record: RentRecord): Promise<void> {
  const text = buildBillText(record)

  if (canNativeShare.value) {
    const nav = navigator as ShareCapableNavigator
    try {
      await nav.share!({
        title: `${record.year}年${record.month}月房租账单`,
        text
      })
      return
    } catch (error) {
      // 用户取消系统分享面板，不弹兜底窗
      if (error instanceof DOMException && error.name === 'AbortError') return
      // 其他失败继续走弹窗兜底
    }
  }

  shareText.value = text
  showSharePopup.value = true
}

async function copyBill(): Promise<void> {
  const ok = await copyText(shareText.value)
  showToast(ok ? '已复制，去微信粘贴给租客吧' : '复制失败，请长按文字手动复制')
}

async function nativeShareFromPopup(): Promise<void> {
  if (!canNativeShare.value) return
  const nav = navigator as ShareCapableNavigator
  try {
    await nav.share!({ title: '房租账单', text: shareText.value })
    showSharePopup.value = false
  } catch {
    // 忽略取消/失败，停留在弹窗
  }
}

async function onDelete(record: RentRecord): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除记录',
      message: `确定删除「${record.tenant}」${record.year}年${record.month}月的记录吗？`
    })
    store.removeRecord(record.id)
    showToast('已删除')
  } catch {
    // 用户取消
  }
}

interface FeeWithAmount extends FeeMeta {
  value: number
}

function feesOf(record: RentRecord): FeeWithAmount[] {
  return FEE_META.map((meta) => ({ ...meta, value: record[meta.key] })).filter(
    (fee) => fee.value > 0
  )
}

function initials(name: string): string {
  const trimmed = name.trim()
  return trimmed ? Array.from(trimmed)[0]!.toUpperCase() : '租'
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #667eea, #764ba2)',
  'linear-gradient(135deg, #f093fb, #f5576c)',
  'linear-gradient(135deg, #4facfe, #00f2fe)',
  'linear-gradient(135deg, #43e97b, #38f9d7)',
  'linear-gradient(135deg, #fa709a, #fee140)',
  'linear-gradient(135deg, #30cfd0, #330867)'
]

function avatarStyle(name: string): { background: string } {
  let hash = 0
  for (const ch of name.trim()) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 997
  }
  return { background: AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length] }
}
</script>

<template>
  <div class="page">
    <header class="app-header">
      <div class="header-title">
        <span class="title-emoji">🏠</span>
        <span>收房租</span>
        <span class="sync-badge" :class="{ off: !syncStore.configured }">
          <van-icon :name="syncStore.syncing ? 'loading' : 'cloud-o'" :class="{ spin: syncStore.syncing }" />
          {{ syncStatusText }}
        </span>
      </div>

      <div class="month-switch">
        <button class="nav-arrow" aria-label="上个月" @click="prevMonth">
          <van-icon name="arrow-left" />
        </button>
        <button class="month-text" title="点击回到本月" @click="goToday">
          {{ year }}年{{ month }}月
          <van-icon v-if="!isCurrentMonth" name="replay" class="replay-icon" />
        </button>
        <button class="nav-arrow" aria-label="下个月" @click="nextMonth">
          <van-icon name="arrow" />
        </button>
      </div>

      <div class="summary-card">
        <div class="summary-main">
          <span class="summary-label">本月应收</span>
          <span class="summary-amount">{{ formatYuan(summary.total) }}</span>
        </div>
        <div class="summary-sub">
          <div class="sub-item">
            <span class="sub-label">已收</span>
            <b class="sub-value">{{ formatYuan(summary.paid) }}</b>
          </div>
          <div class="sub-item">
            <span class="sub-label">未收</span>
            <b class="sub-value warn">{{ formatYuan(summary.unpaid) }}</b>
          </div>
          <div class="sub-item">
            <span class="sub-label">笔数</span>
            <b class="sub-value">{{ summary.count }}</b>
          </div>
        </div>
      </div>
    </header>

    <main class="record-list">
      <van-empty
        v-if="list.length === 0"
        class="empty-state"
        image="search"
        description="本月还没有记录"
      >
        <van-button round type="primary" size="small" @click="goAdd">
          添加本月记录
        </van-button>
      </van-empty>

      <van-swipe-cell v-for="record in list" :key="record.id" class="record-swipe">
        <template #right>
          <van-button
            square
            type="primary"
            text="编辑"
            class="swipe-btn"
            @click="onCardClick(record)"
          />
          <van-button
            square
            type="danger"
            text="删除"
            class="swipe-btn"
            @click="onDelete(record)"
          />
        </template>

        <div class="record-card" @click="onCardClick(record)">
          <div class="record-head">
            <span class="avatar" :style="avatarStyle(record.tenant)">
              {{ initials(record.tenant) }}
            </span>
            <div class="head-info">
              <div class="tenant-name">{{ record.tenant }}</div>
              <div class="record-date">
                {{ record.year }}年{{ record.month }}月 · 点击编辑
              </div>
            </div>
            <button
              class="paid-toggle"
              :class="{ 'is-paid': record.paid }"
              @click.stop="onTogglePaid(record)"
            >
              <van-icon :name="record.paid ? 'checked' : 'clock-o'" />
              {{ record.paid ? '已收' : '未收' }}
            </button>
          </div>

          <div class="fee-chips">
            <span
              v-for="fee in feesOf(record)"
              :key="fee.key"
              class="fee-chip"
              :style="{ '--chip-color': fee.color }"
            >
              {{ fee.emoji }} {{ fee.label }} {{ formatYuan(fee.value) }}
            </span>
            <span v-if="feesOf(record).length === 0" class="fee-empty">
              尚未填写费用金额
            </span>
          </div>

          <div v-if="record.note" class="record-note">备注：{{ record.note }}</div>

          <div class="record-foot">
            <div class="foot-left">
              <span class="foot-label">合计</span>
              <span class="foot-total">{{ formatYuan(recordTotal(record)) }}</span>
            </div>
            <button class="share-btn" @click.stop="onShare(record)">
              <van-icon name="share-o" />
              发给租客
            </button>
          </div>
        </div>
      </van-swipe-cell>
    </main>

    <button class="fab" aria-label="新增记录" @click="goAdd">
      <van-icon name="plus" />
      <span>记一笔</span>
    </button>

    <!-- 分享账单弹窗 -->
    <van-popup
      v-model:show="showSharePopup"
      position="bottom"
      round
      class="share-popup"
    >
      <div class="share-sheet">
        <div class="share-header">
          <span class="share-title">账单预览</span>
          <button class="share-close" aria-label="关闭" @click="showSharePopup = false">
            <van-icon name="cross" />
          </button>
        </div>
        <pre class="share-text">{{ shareText }}</pre>
        <div class="share-actions">
          <van-button round block type="primary" @click="copyBill">复制文字</van-button>
          <van-button
            v-if="canNativeShare"
            round
            block
            plain
            type="primary"
            @click="nativeShareFromPopup"
          >
            系统分享
          </van-button>
        </div>
        <p class="share-tip">💡 复制后可粘贴到微信 / 短信发给租客</p>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.app-header {
  padding: 22px 16px 62px;
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

.sync-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
}

.sync-badge.off {
  opacity: 0.8;
}

.sync-badge .spin {
  animation: badge-spin 0.8s linear infinite;
}

@keyframes badge-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.title-emoji {
  font-size: 20px;
}

.month-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
}

.nav-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.nav-arrow:active {
  background: rgba(255, 255, 255, 0.32);
}

.month-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
}

.replay-icon {
  font-size: 14px;
  opacity: 0.85;
}

.summary-card {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(6px);
}

.summary-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.summary-label {
  font-size: 13px;
  opacity: 0.9;
}

.summary-amount {
  font-size: 30px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.summary-sub {
  display: flex;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(255, 255, 255, 0.28);
}

.sub-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: center;
}

.sub-label {
  font-size: 12px;
  opacity: 0.85;
}

.sub-value {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.sub-value.warn {
  color: #ffe58f;
}

.record-list {
  position: relative;
  z-index: 1;
  margin: -46px 12px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-state {
  margin-top: 30px;
  background: #fff;
  border-radius: var(--card-radius);
  padding: 18px 0;
}

.record-swipe {
  border-radius: var(--card-radius);
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(31, 45, 61, 0.06);
}

.swipe-btn {
  height: 100%;
}

.record-card {
  background: #fff;
  padding: 14px;
  cursor: pointer;
}

.record-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: #fff;
  font-size: 17px;
  font-weight: 700;
}

.head-info {
  flex: 1;
  min-width: 0;
}

.tenant-name {
  font-size: 16px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-date {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-sub);
}

.paid-toggle {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid #ffb340;
  border-radius: 999px;
  background: #fff7e8;
  color: #d48806;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.paid-toggle.is-paid {
  border-color: var(--app-primary);
  background: #e8f8f1;
  color: var(--app-primary);
}

.fee-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.fee-chip {
  --chip-color: #0ba360;
  display: inline-flex;
  align-items: center;
  padding: 4px 9px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--chip-color) 12%, white);
  color: var(--chip-color);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.fee-empty {
  font-size: 12px;
  color: var(--text-sub);
}

.record-note {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-sub);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.record-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.foot-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.share-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 13px;
  border: 1px solid var(--app-primary);
  border-radius: 999px;
  background: #e8f8f1;
  color: var(--app-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.share-btn:active {
  opacity: 0.75;
}

.foot-label {
  font-size: 12px;
  color: var(--text-sub);
}

.foot-total {
  font-size: 19px;
  font-weight: 800;
  color: var(--app-primary);
  font-variant-numeric: tabular-nums;
}

.fab {
  position: fixed;
  right: max(16px, calc((100vw - 640px) / 2 + 16px));
  bottom: calc(78px + env(safe-area-inset-bottom));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 13px 20px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #0ba360, #3cba92);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  box-shadow: 0 6px 18px rgba(11, 163, 96, 0.42);
  cursor: pointer;
  transition: transform 0.12s ease;
}

.fab:active {
  transform: scale(0.94);
}

/* 分享弹窗 */
.share-popup {
  max-width: 640px;
  left: 50%;
  transform: translateX(-50%);
}

.share-sheet {
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
}

.share-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.share-title {
  font-size: 16px;
  font-weight: 700;
}

.share-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: #f0f2f5;
  color: var(--text-sub);
  cursor: pointer;
}

.share-text {
  margin: 0;
  padding: 14px;
  max-height: 44vh;
  overflow: auto;
  border-radius: 12px;
  background: #f7f8fa;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-all;
  -webkit-user-select: text;
  user-select: text;
}

.share-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.share-actions .van-button {
  flex: 1;
}

.share-tip {
  margin: 12px 0 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-sub);
}
</style>
