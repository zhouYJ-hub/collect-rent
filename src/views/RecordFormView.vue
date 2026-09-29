<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showImagePreview, showToast } from 'vant'

import { useRentStore, type RecordDraft } from '@/stores/rent'
import { METER_META, type FeeKey, type MeterKey } from '@/types'
import { formatYuan } from '@/utils/format'
import { compressImage } from '@/utils/image'
import { recognizeDigits } from '@/utils/ocr'

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
  tenant: existing.value?.tenant ?? '',
  note: existing.value?.note ?? '',
  paid: existing.value?.paid ?? false
})

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
  lastReading: string
  currentReading: string
  unitPrice: string
  photo: string
  recognizing: boolean
  hint: string
}

function emptyMeter(): MeterFormState {
  return {
    enabled: false,
    lastReading: '',
    currentReading: '',
    unitPrice: '',
    photo: '',
    recognizing: false,
    hint: ''
  }
}

function initMeter(key: MeterKey): MeterFormState {
  const info = existing.value?.meters?.[key]
  if (!info || info.currentReading == null) return emptyMeter()
  return {
    enabled: true,
    lastReading: info.lastReading != null ? String(info.lastReading) : '',
    currentReading: String(info.currentReading),
    unitPrice: info.unitPrice != null ? String(info.unitPrice) : '',
    photo: info.photo ?? '',
    recognizing: false,
    hint: ''
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

/** 按读数算出的费用；信息不全或本次<上次返回 null */
function meterFeeOf(key: MeterKey): number | null {
  const state = meters[key]
  const last = toNumber(state.lastReading)
  const current = toNumber(state.currentReading)
  const price = toNumber(state.unitPrice)
  if (last == null || current == null || price == null) return null
  if (current < last) return null
  return Math.round((current - last) * price * 100) / 100
}

/** 公式提示文本 */
function formulaOf(key: MeterKey): string | null {
  const state = meters[key]
  const last = toNumber(state.lastReading)
  const current = toNumber(state.currentReading)
  const price = toNumber(state.unitPrice)
  if (last == null || current == null || price == null) return null
  return `(${trimNum(current)} - ${trimNum(last)}) × ${trimNum(price)}`
}

function trimNum(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

function parseAmount(text: string): number {
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 自动带出上一次读数和单价（同租客、本月之前最近一次） */
function autoFillFromHistory(force = false): void {
  if (!form.tenant.trim()) return
  for (const meta of METER_META) {
    const state = meters[meta.key]
    if (!state.enabled) continue
    if (!force && state.lastReading !== '' && state.unitPrice !== '') continue
    const prev = store.findPrevMeter(form.tenant, form.year, form.month, meta.key)
    if (!prev) continue
    if (force || state.lastReading === '') {
      state.lastReading = prev.currentReading != null ? String(prev.currentReading) : ''
    }
    if (state.unitPrice === '' && prev.unitPrice != null) {
      state.unitPrice = String(prev.unitPrice)
    }
  }
}

watch(
  [() => form.tenant, () => form.year, () => form.month],
  () => autoFillFromHistory()
)

function onMeterToggle(key: MeterKey, value: boolean): void {
  meters[key].enabled = value
  if (value) autoFillFromHistory()
}

function refillHistory(key: MeterKey): void {
  if (!form.tenant.trim()) {
    showToast('请先填写租客姓名，才能带出历史读数')
    return
  }
  const prev = store.findPrevMeter(form.tenant, form.year, form.month, key)
  if (!prev || prev.currentReading == null) {
    showToast(`${METER_META.find((m) => m.key === key)?.label ?? ''}暂无历史读数`)
    return
  }
  meters[key].lastReading = String(prev.currentReading)
  if (meters[key].unitPrice === '' && prev.unitPrice != null) {
    meters[key].unitPrice = String(prev.unitPrice)
  }
  showToast(`已带出上次读数 ${prev.currentReading}`)
}

/* ===== 拍照识别 ===== */

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

  const state = meters[key]
  try {
    state.recognizing = true
    state.hint = '照片处理中…'

    const dataUrl = await compressImage(file)
    state.photo = dataUrl

    state.hint = '识别中…首次使用需下载识别模型，请稍候'
    const digits = await recognizeDigits(dataUrl)

    if (digits) {
      state.currentReading = digits
      state.hint = `识别为 ${digits}，请核对`
    } else {
      state.hint = '未识别到数字，请手动输入读数'
    }
  } catch {
    state.hint = '识别失败，请手动输入读数'
  } finally {
    state.recognizing = false
  }
}

function removePhoto(key: MeterKey): void {
  meters[key].photo = ''
  meters[key].hint = ''
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
      throw new Error(`请完整填写${meta.feeLabel}的读数和单价，或关闭「按读数计算」`)
    }

    draft[meta.feeKey] = fee
    draft.meters![meta.key] = {
      lastReading: toNumber(state.lastReading) ?? 0,
      currentReading: toNumber(state.currentReading) ?? 0,
      unitPrice: toNumber(state.unitPrice) ?? 0,
      ...(state.photo ? { photo: state.photo } : {})
    }
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

        <!-- 水 / 电 / 气：支持抄表计算 + 拍照识别 -->
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
              v-model="meters[meta.key].lastReading"
              type="number"
              label="上次读数"
              placeholder="自动带出，可修改"
              input-align="right"
            >
              <template #right-icon>
                <van-icon
                  name="replay"
                  class="refill-icon"
                  title="从历史带出"
                  @click="refillHistory(meta.key)"
                />
              </template>
            </van-field>
            <van-field
              v-model="meters[meta.key].currentReading"
              type="number"
              label="本次读数"
              placeholder="拍照识别或输入"
              input-align="right"
            />

            <div class="photo-row">
              <button
                class="photo-btn"
                :disabled="meters[meta.key].recognizing"
                @click="pickPhoto(meta.key)"
              >
                <van-icon name="photograph" />
                {{ meters[meta.key].photo ? '重新拍照' : '拍照识别' }}
              </button>

              <div v-if="meters[meta.key].photo" class="photo-preview">
                <img
                  :src="meters[meta.key].photo"
                  alt="抄表照片"
                  @click="previewPhoto(meta.key)"
                />
                <button class="photo-del" aria-label="删除照片" @click="removePhoto(meta.key)">
                  <van-icon name="cross" />
                </button>
              </div>
            </div>

            <van-field
              v-model="meters[meta.key].unitPrice"
              type="number"
              :label="`单价(元/${meta.unit})`"
              :placeholder="meta.priceHint"
              input-align="right"
            />

            <div v-if="meters[meta.key].hint" class="meter-hint" :class="{ ok: meters[meta.key].hint.startsWith('识别为') }">
              {{ meters[meta.key].recognizing ? '⏳ ' : '' }}{{ meters[meta.key].hint }}
            </div>

            <div v-if="formulaOf(meta.key) !== null" class="meter-formula">
              🧮 公式：{{ formulaOf(meta.key) }} =
              <b>{{ formatYuan(meterFeeOf(meta.key) ?? 0) }}</b>
              <span v-if="meterFeeOf(meta.key) === null" class="formula-warn">
                （本次读数不能小于上次读数）
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

/* ===== 抄表区块 ===== */
.meter-block {
  border-top: 1px solid #f0f0f0;
}

.meter-block:first-of-type {
  border-top: none;
}

.meter-sub {
  font-size: 12px;
  color: var(--text-sub);
}

.refill-icon {
  color: var(--app-primary);
  font-size: 16px;
  cursor: pointer;
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

.photo-btn:disabled {
  opacity: 0.55;
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

.meter-hint {
  padding: 0 16px 8px;
  font-size: 12px;
  color: var(--text-sub);
}

.meter-hint.ok {
  color: var(--app-primary);
}

.meter-formula {
  margin: 0 16px 12px;
  padding: 9px 12px;
  border-radius: 8px;
  background: #f6ffed;
  color: #389e0d;
  font-size: 13px;
  line-height: 1.6;
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
