<script setup lang="ts">
import { computed, ref } from 'vue'

import { useRentStore } from '@/stores/rent'
import { FEE_META, recordTotal } from '@/types'
import { formatYuan } from '@/utils/format'

const store = useRentStore()

const currentYear = new Date().getFullYear()
const year = ref(currentYear)

const summary = computed(() => store.yearSummary(year.value))
const feeTotals = computed(() => store.feeTotals(year.value))

/** 停车开门弥补（正）与水气误差弥补（负，只扣一次） */
const extraTotals = computed(() => {
  let parking = 0
  let allowance = 0
  for (const r of store.records) {
    if (r.year !== year.value || r.deleted) continue
    parking += r.parkingFee ?? 0
    allowance += r.waterGasAllowance ?? 0
  }
  return { parking, allowance }
})

interface CompositionRow {
  key: string
  label: string
  amount: number
  color: string
  negative: boolean
}

/** 费用构成 = 五项费用 + 押金 + 停车弥补 − 水气误差（与合计口径一致） */
const composition = computed<CompositionRow[]>(() => {
  const rows: CompositionRow[] = FEE_META.map((fee) => ({
    key: fee.key,
    label: `${fee.emoji} ${fee.label}`,
    amount: feeTotals.value[fee.key],
    color: fee.color,
    negative: false
  }))
  if (extraTotals.value.parking > 0) {
    rows.push({
      key: 'parking',
      label: '🅿️ 停车弥补',
      amount: extraTotals.value.parking,
      color: '#f97316',
      negative: false
    })
  }
  if (extraTotals.value.allowance > 0) {
    rows.push({
      key: 'allowance',
      label: '⚖️ 水气误差',
      amount: -extraTotals.value.allowance,
      color: '#d48806',
      negative: true
    })
  }
  return rows.filter((row) => Math.abs(row.amount) > 0)
})

const feeTotalSum = computed(() =>
  composition.value.reduce((sum, row) => sum + row.amount, 0)
)

function rowPercent(row: CompositionRow): string {
  if (feeTotalSum.value <= 0) return '0%'
  return `${((Math.abs(row.amount) / feeTotalSum.value) * 100).toFixed(1)}%`
}

/** 12 个月，倒序展示（最近月份在前） */
const monthly = computed(() =>
  Array.from({ length: 12 }, (_, index) => {
    const month = 12 - index
    const list = store.recordsOfMonth(year.value, month)
    return {
      month,
      count: list.length,
      total: list.reduce((sum, record) => sum + recordTotal(record), 0)
    }
  })
)

const maxMonthlyTotal = computed(() =>
  Math.max(1, ...monthly.value.map((item) => item.total))
)

function monthBarWidth(total: number): string {
  return `${(total / maxMonthlyTotal.value) * 100}%`
}

function prevYear(): void {
  year.value -= 1
}

function nextYear(): void {
  year.value += 1
}
</script>

<template>
  <div class="page">
    <header class="app-header">
      <div class="header-title">
        <span class="title-emoji">📊</span>
        <span>年度统计</span>
      </div>

      <div class="year-switch">
        <button class="nav-arrow" aria-label="上一年" @click="prevYear">
          <van-icon name="arrow-left" />
        </button>
        <span class="year-text">{{ year }} 年</span>
        <button class="nav-arrow" aria-label="下一年" @click="nextYear">
          <van-icon name="arrow" />
        </button>
      </div>
    </header>

    <main class="stats-body">
      <section class="stats-card total-card">
        <div class="total-main">
          <span class="total-label">全年应收</span>
          <span class="total-amount">{{ formatYuan(summary.total) }}</span>
        </div>
        <div class="total-sub">
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
      </section>

      <section class="stats-card">
        <h2 class="card-heading">费用构成</h2>
        <div v-if="feeTotalSum > 0" class="fee-rows">
          <div v-for="row in composition" :key="row.key" class="fee-row">
            <span class="fee-label">{{ row.label }}</span>
            <div class="fee-bar-track">
              <div
                class="fee-bar"
                :style="{ width: rowPercent(row), background: row.color }"
              />
            </div>
            <span class="fee-amount" :class="{ negative: row.negative }">
              {{ row.negative ? '-' : '' }}{{ formatYuan(Math.abs(row.amount)) }}
            </span>
          </div>
        </div>
        <van-empty
          v-else
          image-size="64"
          :description="`${year} 年暂无数据`"
        />
      </section>

      <section class="stats-card">
        <h2 class="card-heading">月度明细</h2>
        <div class="month-rows">
          <div v-for="item in monthly" :key="item.month" class="month-row">
            <span class="month-label">{{ item.month }}月</span>
            <div class="month-bar-track">
              <div class="month-bar" :style="{ width: monthBarWidth(item.total) }" />
            </div>
            <span class="month-amount" :class="{ muted: item.total === 0 }">
              {{ item.total > 0 ? formatYuan(item.total) : '—' }}
            </span>
          </div>
        </div>
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

.year-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
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

.year-text {
  font-size: 20px;
  font-weight: 700;
}

.stats-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 12px;
}

.stats-card {
  background: #fff;
  border-radius: var(--card-radius);
  padding: 16px;
  box-shadow: 0 2px 10px rgba(31, 45, 61, 0.05);
}

.card-heading {
  margin: 0 0 14px;
  font-size: 15px;
  font-weight: 700;
}

.total-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.total-label {
  font-size: 13px;
  color: var(--text-sub);
}

.total-amount {
  font-size: 30px;
  font-weight: 800;
  color: var(--app-primary);
  font-variant-numeric: tabular-nums;
}

.total-sub {
  display: flex;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #ececec;
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
  color: var(--text-sub);
}

.sub-value {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.sub-value.warn {
  color: #d48806;
}

.fee-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fee-row {
  display: grid;
  grid-template-columns: 74px 1fr 84px;
  align-items: center;
  gap: 10px;
}

.fee-label {
  font-size: 13px;
  font-weight: 600;
}

.fee-bar-track {
  height: 10px;
  border-radius: 5px;
  background: #f0f2f5;
  overflow: hidden;
}

.fee-bar {
  height: 100%;
  min-width: 2px;
  border-radius: 5px;
  transition: width 0.3s ease;
}

.fee-amount.negative {
  color: #d48806;
}

.fee-amount {
  font-size: 13px;
  font-weight: 700;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.month-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.month-row {
  display: grid;
  grid-template-columns: 44px 1fr 84px;
  align-items: center;
  gap: 10px;
}

.month-label {
  font-size: 13px;
  color: var(--text-sub);
}

.month-bar-track {
  height: 8px;
  border-radius: 4px;
  background: #f0f2f5;
  overflow: hidden;
}

.month-bar {
  height: 100%;
  min-width: 2px;
  border-radius: 4px;
  background: linear-gradient(90deg, #0ba360, #3cba92);
  transition: width 0.3s ease;
}

.month-amount {
  font-size: 13px;
  font-weight: 700;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.month-amount.muted {
  color: #c8c9cc;
  font-weight: 400;
}
</style>
