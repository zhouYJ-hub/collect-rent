<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { closeToast, showConfirmDialog, showLoadingToast, showToast } from 'vant'

import { useRentStore } from '@/stores/rent'
import { useSyncStore } from '@/stores/sync'
import {
  FEE_META,
  METER_META,
  houseTypeMeta,
  recordTotal,
  type FeeMeta,
  type RentRecord
} from '@/types'
import { buildBillText } from '@/utils/bill'
import { renderBillImage, type BillPhotoGroup, type BillPhotoItem } from '@/utils/billImage'
import { copyImage, copyText } from '@/utils/clipboard'
import { formatYuan } from '@/utils/format'
import { blobToDataURL } from '@/utils/image'

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

/* ===== 分享账单截图给租客 ===== */

const showSharePopup = ref(false)
const shareText = ref('')
const shareImageUrl = ref('')
const shareBlob = ref<Blob | null>(null)
const shareTypeText = ref('')

type ShareCapableNavigator = Navigator & {
  share?: (data: { title?: string; text?: string; files?: File[] }) => Promise<void>
  canShare?: (data: { files?: File[] }) => boolean
}

const canShareImage = computed(() => {
  if (!shareBlob.value) return false
  const nav = navigator as ShareCapableNavigator
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
  const file = new File([shareBlob.value], 'bill.png', { type: 'image/png' })
  return nav.canShare({ files: [file] })
})

watch(showSharePopup, (visible) => {
  if (visible) return
  shareImageUrl.value = ''
  shareBlob.value = null
})

/** 固定三格（水/电/气），缺照片 → 空串，截图里显示「暂无」占位 */
function collectFixed(source: RentRecord | undefined): BillPhotoItem[] {
  return METER_META.map((meta) => ({
    caption: `${meta.emoji} ${meta.label}`,
    src: source?.meters?.[meta.key]?.photo ?? ''
  }))
}

/** 组装抄表照片：
 *  - 楼上分享：本次 / 上次 两组
 *  - 楼下分享：自己本次 / 自己上次 / 楼上起始月 / 楼上截止月 四组
 *  每组固定 水/电/气 三个位置，顺序一致，数据不会错位 */
function buildPhotoGroups(record: RentRecord): BillPhotoGroup[] {
  // ① 自己本次 ② 自己上次
  const prevRecord = store.findPrevHouseRecord(
    record.houseType ?? 'upstairs',
    record.year,
    record.month
  )

  const isDownstairs = (record.houseType ?? 'upstairs') === 'downstairs'
  let fromRecord: RentRecord | undefined
  let toRecord: RentRecord | undefined
  let fromLabel = ''
  let toLabel = ''

  if (isDownstairs) {
    // ③ 楼上起始月 ④ 楼上截止月（选了期间用所选月份，否则默认楼上本月 + 上次）
    const range = record.refRange
    if (range) {
      // 起始月照片 = 起始月的「上次」记录照片（差值 = 到月本次 − 从月上次，照片对应）
      fromRecord = store.findPrevHouseRecord('upstairs', range.fromYear, range.fromMonth)
      toRecord = store.findLatestHouseRecord('upstairs', range.toYear, range.toMonth)
      fromLabel = `${range.fromYear}年${range.fromMonth}月`
      toLabel = `${range.toYear}年${range.toMonth}月`
    } else {
      toRecord = store.findLatestHouseRecord('upstairs', record.year, record.month)
      fromRecord = toRecord
        ? store.findPrevHouseRecord('upstairs', toRecord.year, toRecord.month)
        : undefined
      fromLabel = fromRecord ? `${fromRecord.year}年${fromRecord.month}月` : ''
      toLabel = toRecord ? `${toRecord.year}年${toRecord.month}月` : ''
    }
  }

  const groups: BillPhotoGroup[] = [
    { title: '本次抄表照片', photos: collectFixed(record) },
    { title: '上次抄表照片', photos: collectFixed(prevRecord) }
  ]
  if (isDownstairs) {
    groups.push({
      title: `楼上起始月照片${fromLabel ? `（${fromLabel}）` : ''}`,
      photos: collectFixed(fromRecord)
    })
    groups.push({
      title: `楼上截止月照片${toLabel ? `（${toLabel}）` : ''}`,
      photos: collectFixed(toRecord)
    })
  }
  return groups
}

/** 点击分享：生成含抄表照片的截图 → 弹窗预览 → 复制/长按/系统分享 */
async function onShare(record: RentRecord): Promise<void> {
  showLoadingToast({ message: '正在生成截图…', forbidClick: true, duration: 0 })
  try {
    const blob = await renderBillImage(record, buildPhotoGroups(record))
    shareBlob.value = blob
    // dataURL 显示（微信 blob: 地址不支持长按菜单）
    shareImageUrl.value = await blobToDataURL(blob)
    shareText.value = buildBillText(record)
    const typeMeta = houseTypeMeta(record.houseType)
    shareTypeText.value = typeMeta ? `${typeMeta.emoji} ${typeMeta.label}` : ''

    // 弹窗中展示账单截图，用户通过 复制/长按/系统分享 发给租客
    showSharePopup.value = true
  } catch {
    showToast('截图生成失败，请重试')
  } finally {
    closeToast()
  }
}

/** 弹窗内再次尝试复制截图 */
async function copyImageAgain(): Promise<void> {
  if (!shareBlob.value) return
  const ok = await copyImage(shareBlob.value)
  showToast(ok ? '截图已复制，去微信粘贴' : '当前浏览器不支持复制图片，请长按截图发送')
}

/** 系统分享（支持分享图片文件的浏览器） */
async function nativeShareImage(): Promise<void> {
  if (!shareBlob.value) return
  const nav = navigator as ShareCapableNavigator
  const file = new File([shareBlob.value], 'bill.png', { type: 'image/png' })
  try {
    await nav.share!({ title: '房租账单', files: [file] })
    showSharePopup.value = false
  } catch {
    // 用户取消或失败，停留在弹窗
  }
}

/** 保存图片到本地 */
function saveImage(): void {
  if (!shareImageUrl.value) return
  const link = document.createElement('a')
  link.href = shareImageUrl.value
  link.download = `房租账单-${new Date().getFullYear()}-${new Date().getMonth() + 1}.png`
  link.click()
}

/** 文字版兜底 */
async function copyTextVersion(): Promise<void> {
  const ok = await copyText(shareText.value)
  showToast(ok ? '文字版已复制' : '复制失败，请重试')
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

/** 额外标签：水气误差弥补 / 停车开门弥补（押金已含在费用标签中） */
function extraChips(record: RentRecord): { text: string; color: string }[] {
  const chips: { text: string; color: string }[] = []
  if (record.waterGasAllowance && record.waterGasAllowance > 0) {
    chips.push({
      text: `⚖️ 误差弥补 -${formatYuan(record.waterGasAllowance)}`,
      color: '#d48806'
    })
  }
  if (record.parkingFee && record.parkingFee > 0) {
    chips.push({ text: `🅿️ 停车 -${formatYuan(record.parkingFee)}`, color: '#f97316' })
  }
  return chips
}

function houseTag(record: RentRecord): string {
  const meta = houseTypeMeta(record.houseType)
  return meta ? `${meta.emoji} ${meta.label}` : ''
}

function houseColor(record: RentRecord): string {
  return houseTypeMeta(record.houseType)?.color ?? '#969799'
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
              <div class="tenant-line">
                <span class="tenant-name">{{ record.tenant }}</span>
                <span
                  v-if="houseTag(record)"
                  class="house-tag"
                  :style="{ '--tag-color': houseColor(record) }"
                >
                  {{ houseTag(record) }}
                </span>
              </div>
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
            <span
              v-for="(chip, index) in extraChips(record)"
              :key="`extra-${index}`"
              class="fee-chip"
              :style="{ '--chip-color': chip.color }"
            >
              {{ chip.text }}
            </span>
            <span
              v-if="feesOf(record).length === 0 && extraChips(record).length === 0"
              class="fee-empty"
            >
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
          <span class="share-title">
              <span v-if="shareTypeText" class="share-type">{{ shareTypeText }}</span>
              账单截图
            </span>
          <button class="share-close" aria-label="关闭" @click="showSharePopup = false">
            <van-icon name="cross" />
          </button>
        </div>

        <div class="share-img-wrap">
          <img v-if="shareImageUrl" :src="shareImageUrl" class="share-img" alt="账单截图" />
        </div>

        <div class="share-actions">
          <van-button round type="primary" @click="copyImageAgain">复制截图</van-button>
          <van-button v-if="canShareImage" round plain type="primary" @click="nativeShareImage">
            系统分享
          </van-button>
          <van-button round plain type="default" @click="saveImage">保存图片</van-button>
        </div>

        <p class="share-tip">
          💡 在微信里可<b>长按截图</b>直接发送给租客；已复制的可直接粘贴
        </p>
        <button class="text-fallback" @click="copyTextVersion">复制文字版账单 →</button>
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

.tenant-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tenant-name {
  font-size: 16px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.house-tag {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--tag-color) 12%, white);
  color: var(--tag-color);
  font-size: 11px;
  font-weight: 600;
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 700;
}

.share-type {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  background: #eef3ff;
  color: #4f7cff;
  font-size: 12px;
  font-weight: 600;
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

.share-img-wrap {
  max-height: 48vh;
  overflow: auto;
  border-radius: 12px;
  background: #f0f2f5;
  -webkit-overflow-scrolling: touch;
}

.share-img {
  display: block;
  width: 100%;
  /* 允许微信/浏览器长按菜单（转发、保存） */
  -webkit-touch-callout: default !important;
  -webkit-user-select: auto !important;
  user-select: auto !important;
  pointer-events: auto;
}

.text-fallback {
  display: block;
  margin: 2px auto 0;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--app-primary);
  font-size: 13px;
  cursor: pointer;
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
