<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showImagePreview, showToast } from 'vant'

import { useRentStore, type RecordDraft } from '@/stores/rent'
import { HOUSE_TYPES, METER_META, type FeeKey, type HouseType, type MeterKey } from '@/types'
import { formatYuan } from '@/utils/format'
import { compressImage } from '@/utils/image'

const route = useRoute()
const router = useRouter()
const store = useRentStore()

const editId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const isEdit = computed(() => editId.value.length > 0)
const existing = computed(() => (editId.value ? store.findById(editId.value) : undefined))

if (editId.value && (!existing.value || existing.value.deleted)) {
  showToast('记录不存在')
  router.replace('/')
}

const now = new Date()

const form = reactive({
  year: existing.value?.year ?? now.getFullYear(),
  month: existing.value?.month ?? now.getMonth() + 1,
  houseType: (existing.value?.houseType ?? 'upstairs') as HouseType,
  tenant: existing.value?.tenant ?? '',
  note: existing.value?.note ?? '',
  paid: existing.value?.paid ?? false
})

/* ===== 单价规则 ===== */
/** 水费 / 燃气费固定单价 */
const FIXED_PRICES: Partial<Record<MeterKey, number>> = {
  water: 3,
  gas: 3
}

/** 电价：楼上 0.6，楼下 0.52 */
function electricityPrice(houseType: HouseType): number {
  return houseType === 'upstairs' ? 0.6 : 0.52
}

function defaultPrice(key: MeterKey, houseType: HouseType): number {
  return key === 'electricity' ? electricityPrice(houseType) : (FIXED_PRICES[key] ?? 0)
}

function initAmount(value: number | undefined): string {
  return value && value > 0 ? String(value) : ''
}

/** 直接填金额模式（房租 / 垃圾费 / 未开启抄表的表） */
const amountText = reactive<Record<FeeKey, string>>({
  rent: initAmount(existing.value?.rent),
  water: initAmount(existing.value?.water),
  electricity: initAmount(existing.value?.electricity),
  gas: initAmount(existing.value?.gas),
  garbage: initAmount(existing.value?.garbage)
})

/* ===== 抄表模式（水/电/气） ===== */

interface MeterFormState {
  /** 是否按读数计算 */
  enabled: boolean
  /** 上次读数（手动输入） */
  lastReading: string
  /** 本次读数（手动输入） */
  currentReading: string
  /** 单价 */
  unitPrice: string
  /** 抄表照片（仅存档） */
  photo: string
  /** 楼上本月读数（仅楼下使用，自动从本月楼上记录带出） */
  upstairsUsage: string
}

function emptyMeter(key: MeterKey): MeterFormState {
  return {
    enabled: false,
    lastReading: '',
    currentReading: '',
    unitPrice: String(defaultPrice(key, form.houseType)),
    photo: '',
    upstairsUsage: ''
  }
}

function initMeter(key: MeterKey): MeterFormState {
  const info = existing.value?.meters?.[key]
  if (!info || info.currentReading == null) return emptyMeter(key)
  return {
    enabled: true,
    lastReading: info.lastReading != null ? String(info.lastReading) : '',
    currentReading: String(info.currentReading),
    unitPrice: info.unitPrice != null ? String(info.unitPrice) : String(defaultPrice(key, form.houseType)),
    photo: info.photo ?? '',
    upstairsUsage: info.refUsage != null ? String(info.refUsage) : ''
  }
}

const meters = reactive<Record<MeterKey, MeterFormState>>({
  water: initMeter('water'),
  electricity: initMeter('electricity'),
  gas: initMeter('gas')
})

function toNumber(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/* ===== 楼下：自动带出本月楼上读数 ===== */

const isDownstairs = computed(() => form.houseType === 'downstairs')

/** 从本月「楼上」记录计算水/电/气用量（楼上本次 - 楼上上次），只读展示并参与楼下公式 */
function syncUpstairsUsage(): void {
  if (!isDownstairs.value) return
  const upstairs = store.findLatestHouseRecord('upstairs', form.year, form.month)
  for (const meta of METER_META) {
    const info = upstairs?.meters?.[meta.key]
    meters[meta.key].upstairsUsage =
      info?.currentReading != null && info?.lastReading != null
        ? String(Math.round((info.currentReading - info.lastReading) * 1000) / 1000)
        : ''
  }
}

/* ===== 上次读数自动带出：同租客 + 同房屋类型，本月之前最近一次的「本次读数」 ===== */

function autoFillLastReadings(): void {
  if (!form.tenant.trim()) return
  for (const meta of METER_META) {
    const state = meters[meta.key]
    if (!state.enabled || state.lastReading.trim() !== '') continue
    const prev = store.findPrevMeter(form.tenant, form.houseType, form.year, form.month, meta.key)
    if (prev?.currentReading != null) {
      state.lastReading = String(prev.currentReading)
    }
  }
}

watch(
  [() => form.tenant, () => form.houseType, () => form.year, () => form.month],
  () => {
    syncUpstairsUsage()
    autoFillLastReadings()
  },
  { immediate: true }
)

function onMeterToggle(key: MeterKey, value: boolean): void {
  meters[key].enabled = value
  if (value) autoFillLastReadings()
}

/* ===== 切换房屋类型：电价联动 ===== */

watch(
  () => form.houseType,
  (type) => {
    meters.electricity.unitPrice = String(electricityPrice(type))
  }
)

/* ===== 用量与费用计算 ===== */

/** 本次用量：楼上=本次-上次；楼下=本次-上次-楼上本月读数 */
function meterUsageOf(key: MeterKey): number | null {
  const state = meters[key]
  const last = toNumber(state.lastReading)
  const current = toNumber(state.currentReading)
  if (last == null || current == null) return null

  if (isDownstairs.value) {
    const ref = toNumber(state.upstairsUsage)
    if (ref == null) return null
    return Math.round((current - last - ref) * 1000) / 1000
  }
  return Math.round((current - last) * 1000) / 1000
}

function meterPriceOf(key: MeterKey): number | null {
  return toNumber(meters[key].unitPrice)
}

function meterFeeOf(key: MeterKey): number | null {
  const usage = meterUsageOf(key)
  const price = meterPriceOf(key)
  if (usage == null || price == null || usage < 0) return null
  return Math.round(usage * price * 100) / 100
}

function trimNum(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/** 用量算式：楼上「本次-上次」；楼下「本次-上次-楼上读数」 */
function usageBreakdownOf(key: MeterKey): string {
  const state = meters[key]
  const last = toNumber(state.lastReading)
  const current = toNumber(state.currentReading)
  if (last == null || current == null) return ''
  const ref = isDownstairs.value ? toNumber(state.upstairsUsage) : null
  if (isDownstairs.value && ref == null) return ''
  return ref != null
    ? `${trimNum(current)} - ${trimNum(last)} - ${trimNum(ref)}`
    : `${trimNum(current)} - ${trimNum(last)}`
}

/** 公式提示：楼上 (本次-上次)×单价；楼下 (本次-上次-楼上读数)×单价 */
function formulaOf(key: MeterKey): string | null {
  const state = meters[key]
  const last = toNumber(state.lastReading)
  const current = toNumber(state.currentReading)
  const price = meterPriceOf(key)
  if (last == null || current == null || price == null) return null

  const ref = isDownstairs.value ? toNumber(state.upstairsUsage) : null
  if (isDownstairs.value && ref == null) return null

  const refPart = ref != null ? ` - ${trimNum(ref)}` : ''
  return `(${trimNum(current)} - ${trimNum(last)}${refPart}) × ${trimNum(price)}`
}

function parseAmount(text: string): number {
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/* ===== 图片上传（仅存档，不识别） ===== */

const fileInput = ref<HTMLInputElement | null>(null)
const activeMeter = ref<MeterKey | null>(null)

function pickPhoto(key: MeterKey): void {
  activeMeter.value = key
  fileInput.value?.click()
}

async function onPhotoChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const key = activeMeter.value
  if (!file || !key) return

  try {
    showToast('照片处理中…')
    meters[key].photo = await compressImage(file)
    showToast('已上传')
  } catch {
    showToast('照片处理失败，请重试')
  }
}

function removePhoto(key: MeterKey): void {
  meters[key].photo = ''
}

function previewPhoto(key: MeterKey): void {
  const photo = meters[key].photo
  if (photo) showImagePreview([photo])
}

/* ===== 年月选择器 ===== */

const showMonthPicker = ref(false)
const minDate = new Date(2020, 0, 1)
const maxDate = new Date(2035, 11, 1)

const pickerValue = computed(() => [String(form.year), String(form.month).padStart(2, '0')])
const monthText = computed(() => `${form.year}年${form.month}月`)

function onMonthConfirm(date: Date): void {
  form.year = date.getFullYear()
  form.month = date.getMonth() + 1
  showMonthPicker.value = false
}

/* ===== 合计与保存 ===== */

const total = computed(() => {
  let sum = parseAmount(amountText.rent) + parseAmount(amountText.garbage)
  for (const meta of METER_META) {
    sum += meters[meta.key].enabled
      ? (meterFeeOf(meta.key) ?? 0)
      : parseAmount(amountText[meta.feeKey])
  }
  return sum
})

function buildDraft(): RecordDraft {
  const draft: RecordDraft = {
    year: form.year,
    month: form.month,
    houseType: form.houseType,
    tenant: form.tenant,
    rent: parseAmount(amountText.rent),
    water: 0,
    electricity: 0,
    gas: 0,
    garbage: parseAmount(amountText.garbage),
    note: form.note,
    paid: form.paid,
    meters: {}
  }

  for (const meta of METER_META) {
    const state = meters[meta.key]
    if (!state.enabled) {
      draft[meta.feeKey] = parseAmount(amountText[meta.feeKey])
      continue
    }

    const fee = meterFeeOf(meta.key)
    if (fee == null) {
      if (isDownstairs.value && toNumber(state.upstairsUsage) == null) {
        throw new Error(`请先保存「楼上」${form.year}年${form.month}月的抄表记录（需含本次/上次读数），楼下才能自动带出楼上用量`)
      }
      throw new Error(`请完整填写${meta.feeLabel}的读数和单价，或关闭「按读数计算」`)
    }

    const meterInfo: NonNullable<RecordDraft['meters']>[MeterKey] = {
      lastReading: toNumber(state.lastReading) ?? 0,
      currentReading: toNumber(state.currentReading) ?? 0,
      unitPrice: meterPriceOf(meta.key) ?? 0,
      ...(state.photo ? { photo: state.photo } : {})
    }
    if (isDownstairs.value) {
      meterInfo.refUsage = toNumber(state.upstairsUsage) ?? 0
    }

    draft[meta.feeKey] = fee
    draft.meters![meta.key] = meterInfo
  }

  return draft
}

async function onSave(): Promise<void> {
  if (!form.tenant.trim()) {
    showToast('请填写租客姓名')
    return
  }

  let draft: RecordDraft
  try {
    draft = buildDraft()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '请检查费用填写')
    return
  }

  const duplicate = store.findDuplicate(draft, editId.value || undefined)
  if (duplicate) {
    try {
      await showConfirmDialog({
        title: '重复提醒',
        message: `「${draft.tenant.trim()}」在 ${draft.year}年${draft.month}月 已有记录，仍要保存吗？`
      })
    } catch {
      return
    }
  }

  try {
    store.saveRecord(draft, editId.value || undefined)
    showToast(isEdit.value ? '已更新' : '已保存')
    router.back()
  } catch {
    showToast('保存失败，请重试')
  }
}

async function onDelete(): Promise<void> {
  if (!editId.value) return
  try {
    await showConfirmDialog({
      title: '删除记录',
      message: '删除后无法恢复，确定删除吗？'
    })
    store.removeRecord(editId.value)
    showToast('已删除')
    router.replace('/')
  } catch {
    // 用户取消
  }
}
</script>

<template>
  <div class="page form-page">
    <van-nav-bar
      :title="isEdit ? '编辑记录' : '记一笔'"
      left-arrow
      fixed
      placeholder
      safe-area-inset-top
      @click-left="router.back()"
    />

    <div class="form-body">
      <van-cell-group inset class="form-card">
        <van-field
          :model-value="monthText"
          label="月份"
          placeholder="选择月份"
          readonly
          is-link
          required
          input-align="right"
          @click="showMonthPicker = true"
        />

        <div class="house-type-row">
          <span class="ht-label">房屋类型</span>
          <div class="ht-options">
            <button
              v-for="t in HOUSE_TYPES"
              :key="t.value"
              type="button"
              class="ht-option"
              :class="{ active: form.houseType === t.value }"
              :style="{ '--ht-color': t.color }"
              @click="form.houseType = t.value"
            >
              {{ t.emoji }} {{ t.label }}
            </button>
          </div>
        </div>

        <van-field
          v-model="form.tenant"
          label="租客"
          placeholder="租客姓名，如：张三"
          clearable
          required
          input-align="right"
        />
      </van-cell-group>

      <van-cell-group inset class="form-card">
        <div class="card-title">费用明细（元）</div>

        <van-field
          v-model="amountText.rent"
          type="number"
          label="🏠 房租"
          placeholder="如 2000"
          input-align="right"
        />

        <!-- 水 / 电 / 气：按读数计算 -->
        <div v-for="meta in METER_META" :key="meta.key" class="meter-block">
          <van-cell center :title="`${meta.emoji} ${meta.feeLabel}`">
            <template #label>
              <span class="meter-sub">按读数计算（{{ meta.unit }}）</span>
            </template>
            <template #right-icon>
              <van-switch
                :model-value="meters[meta.key].enabled"
                size="20px"
                @update:model-value="(val: boolean) => onMeterToggle(meta.key, val)"
              />
            </template>
          </van-cell>

          <template v-if="meters[meta.key].enabled">
            <van-field
              v-model="meters[meta.key].currentReading"
              type="number"
              label="本次读数"
              placeholder="手动输入本次读数"
              input-align="right"
            />
            <van-field
              v-model="meters[meta.key].lastReading"
              type="number"
              label="上次读数"
              placeholder="自动带出上次读数"
              input-align="right"
            />

            <!-- 楼下：自动带出本月楼上读数（只读） -->
            <div v-if="isDownstairs" class="ref-reading" :class="{ missing: meters[meta.key].upstairsUsage === '' }">
              <template v-if="meters[meta.key].upstairsUsage !== ''">
                ⬆️ 楼上本月用量：<b>{{ meters[meta.key].upstairsUsage }}</b>
                <span class="ref-tip">（自动带出 = 楼上本次 - 楼上上次，楼下用量将扣除此用量）</span>
              </template>
              <template v-else>
                ⚠️ 未找到楼上本月用量，请先保存「楼上」{{ form.year }}年{{ form.month }}月的抄表记录（需含本次/上次读数）
              </template>
            </div>

            <div class="photo-row">
              <button type="button" class="photo-btn" @click="pickPhoto(meta.key)">
                <van-icon name="photograph" />
                {{ meters[meta.key].photo ? '重新上传图片' : '上传图片' }}
              </button>

              <div v-if="meters[meta.key].photo" class="photo-preview">
                <img
                  :src="meters[meta.key].photo"
                  alt="抄表照片"
                  @click="previewPhoto(meta.key)"
                />
                <button class="photo-del" aria-label="删除图片" @click="removePhoto(meta.key)">
                  <van-icon name="cross" />
                </button>
              </div>
            </div>

            <van-field
              v-model="meters[meta.key].unitPrice"
              type="number"
              :label="`单价(元/${meta.unit})`"
              :placeholder="meta.priceHint"
              :readonly="meta.key !== 'electricity'"
              input-align="right"
            />

            <div v-if="meterUsageOf(meta.key) !== null" class="meter-usage" :class="{ 'warn-bg': meterUsageOf(meta.key)! < 0 }">
              <template v-if="meterUsageOf(meta.key)! < 0">⚠️</template>
              <template v-else>📊</template>
              本次用量：<b>{{ meterUsageOf(meta.key) }}</b> {{ meta.unit }}
              <span class="usage-tip">（{{ usageBreakdownOf(meta.key) }}）</span>
            </div>

            <div v-if="formulaOf(meta.key) !== null" class="meter-formula">
              🧮 公式：{{ formulaOf(meta.key) }} =
              <b>{{ formatYuan(meterFeeOf(meta.key) ?? 0) }}</b>
              <span v-if="meterUsageOf(meta.key) !== null && meterUsageOf(meta.key)! < 0" class="formula-warn">
                （用量为负，请检查读数）
              </span>
            </div>
          </template>

          <van-field
            v-else
            v-model="amountText[meta.feeKey]"
            type="number"
            :label="`${meta.emoji} ${meta.feeLabel}`"
            placeholder="直接填金额"
            input-align="right"
          />
        </div>

        <van-field
          v-model="amountText.garbage"
          type="number"
          label="🧹 垃圾费"
          placeholder="没有可留空"
          input-align="right"
        />
      </van-cell-group>

      <van-cell-group inset class="form-card">
        <van-field
          v-model="form.note"
          type="textarea"
          rows="2"
          autosize
          label="备注"
          placeholder="抄表数、缴费说明等（选填）"
        />
        <van-cell center title="已收款">
          <template #right-icon>
            <van-switch v-model="form.paid" size="22px" />
          </template>
        </van-cell>
      </van-cell-group>

      <button v-if="isEdit" class="delete-link" @click="onDelete">
        删除这条记录
      </button>
    </div>

    <div class="form-footer">
      <div class="footer-total">
        合计 <b>{{ formatYuan(total) }}</b>
      </div>
      <van-button round type="primary" class="save-btn" @click="onSave">
        {{ isEdit ? '保存修改' : '保存' }}
      </van-button>
    </div>

    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-date-picker
        :model-value="pickerValue"
        type="year-month"
        title="选择月份"
        :min-date="minDate"
        :max-date="maxDate"
        @confirm="onMonthConfirm"
        @cancel="showMonthPicker = false"
      />
    </van-popup>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden-input"
      @change="onPhotoChosen"
    />
  </div>
</template>

<style scoped>
.form-page {
  padding-bottom: calc(96px + env(safe-area-inset-bottom));
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
}

.form-card {
  margin: 0 12px;
}

.card-title {
  padding: 14px 16px 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-sub);
}

/* ===== 房屋类型选择 ===== */
.house-type-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  font-size: 14px;
}

.ht-label {
  flex-shrink: 0;
  color: var(--text-main);
}

.ht-label::after {
  content: ' *';
  color: #ee0a24;
}

.ht-options {
  flex: 1;
  display: flex;
  gap: 10px;
}

.ht-option {
  flex: 1;
  padding: 9px 0;
  border: 1px solid #dcdee0;
  border-radius: 8px;
  background: #fff;
  color: var(--text-main);
  font-size: 14px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.ht-option.active {
  border-color: var(--ht-color);
  background: color-mix(in srgb, var(--ht-color) 10%, white);
  color: var(--ht-color);
  font-weight: 700;
}

/* ===== 抄表区块 ===== */
.meter-block {
  border-top: 1px solid #f0f0f0;
}

.meter-sub {
  font-size: 12px;
  color: var(--text-sub);
}

.ref-reading {
  margin: 0 16px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #eef3ff;
  color: #4f7cff;
  font-size: 12px;
  line-height: 1.6;
}

.ref-reading.missing {
  background: #fff7e8;
  color: #d48806;
}

.ref-reading b {
  font-size: 13px;
}

.ref-tip {
  opacity: 0.75;
}

.photo-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
}

.photo-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border: 1px dashed var(--app-primary);
  border-radius: 8px;
  background: #e8f8f1;
  color: var(--app-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.photo-preview {
  position: relative;
}

.photo-preview img {
  display: block;
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 8px;
  cursor: zoom-in;
}

.photo-del {
  position: absolute;
  top: -6px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
}

.meter-usage {
  margin: 0 16px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f0f7ff;
  color: #1677ff;
  font-size: 13px;
  line-height: 1.6;
}

.meter-usage.warn-bg {
  background: #fff1f0;
  color: #ee0a24;
}

.meter-usage b {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.usage-tip {
  font-size: 11px;
  opacity: 0.7;
}

.meter-formula {
  margin: 8px 16px 12px;
  padding: 9px 12px;
  border-radius: 8px;
  background: #f6ffed;
  color: #389e0d;
  font-size: 13px;
  line-height: 1.6;
}

.meter-formula.warn-bg {
  background: #fff1f0;
  color: #ee0a24;
}

.meter-formula b {
  font-variant-numeric: tabular-nums;
}

.formula-warn {
  color: #d48806;
}

.delete-link {
  margin: 8px auto;
  padding: 10px 20px;
  border: none;
  background: transparent;
  color: #ee0a24;
  font-size: 14px;
  cursor: pointer;
}

.form-footer {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0;
  width: 100%;
  max-width: 640px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  border-top: 1px solid #ececec;
}

.footer-total {
  flex: 1;
  font-size: 14px;
  color: var(--text-sub);
}

.footer-total b {
  margin-left: 4px;
  font-size: 21px;
  font-weight: 800;
  color: var(--app-primary);
  font-variant-numeric: tabular-nums;
}

.save-btn {
  min-width: 132px;
  font-weight: 700;
}

.hidden-input {
  display: none;
}
</style>
