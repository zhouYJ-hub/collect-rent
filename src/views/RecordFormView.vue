<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'

import { useRentStore, type RecordDraft } from '@/stores/rent'
import { FEE_META, type FeeKey } from '@/types'
import { formatYuan } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const store = useRentStore()

const editId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const isEdit = computed(() => editId.value.length > 0)
const existing = computed(() => (editId.value ? store.findById(editId.value) : undefined))

if (editId.value && !existing.value) {
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

const amountText = reactive<Record<FeeKey, string>>({
  rent: initAmount(existing.value?.rent),
  water: initAmount(existing.value?.water),
  electricity: initAmount(existing.value?.electricity),
  gas: initAmount(existing.value?.gas),
  garbage: initAmount(existing.value?.garbage)
})

function parseAmount(text: string): number {
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : 0
}

const total = computed(
  () =>
    parseAmount(amountText.rent) +
    parseAmount(amountText.water) +
    parseAmount(amountText.electricity) +
    parseAmount(amountText.gas) +
    parseAmount(amountText.garbage)
)

/* 年月选择器 */
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

function buildDraft(): RecordDraft {
  return {
    year: form.year,
    month: form.month,
    tenant: form.tenant,
    rent: parseAmount(amountText.rent),
    water: parseAmount(amountText.water),
    electricity: parseAmount(amountText.electricity),
    gas: parseAmount(amountText.gas),
    garbage: parseAmount(amountText.garbage),
    note: form.note,
    paid: form.paid
  }
}

async function onSave(): Promise<void> {
  if (!form.tenant.trim()) {
    showToast('请填写租客姓名')
    return
  }

  const draft = buildDraft()

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
          v-for="fee in FEE_META"
          :key="fee.key"
          v-model="amountText[fee.key]"
          type="number"
          :label="`${fee.emoji} ${fee.label}`"
          :placeholder="fee.key === 'rent' ? '如 2000' : '没有可留空'"
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
</style>
