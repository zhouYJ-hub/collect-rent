import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import type { FeeKey, RentRecord } from '@/types'
import { recordTotal } from '@/types'
import { genId } from '@/utils/id'

const STORAGE_KEY = 'zyj-collect-rent:records:v1'

/** 新增/编辑时的表单数据 */
export interface RecordDraft {
  year: number
  month: number
  tenant: string
  rent: number
  water: number
  electricity: number
  gas: number
  garbage: number
  note: string
  paid: boolean
}

export interface PeriodSummary {
  count: number
  total: number
  paid: number
  unpaid: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 从 localStorage 读取时做一次结构校验，防止脏数据 */
function isRentRecord(value: unknown): value is RentRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    isFiniteNumber(r.year) &&
    isFiniteNumber(r.month) &&
    typeof r.tenant === 'string' &&
    typeof r.note === 'string' &&
    typeof r.paid === 'boolean' &&
    isFiniteNumber(r.createdAt) &&
    isFiniteNumber(r.updatedAt) &&
    (['rent', 'water', 'electricity', 'gas', 'garbage'] as const).every((key) =>
      isFiniteNumber(r[key])
    )
  )
}

function loadRecords(): RentRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRentRecord)
  } catch {
    return []
  }
}

export const useRentStore = defineStore('rent', () => {
  const records = ref<RentRecord[]>(loadRecords())

  watch(
    records,
    (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch {
        // 存储不可用时静默降级，本次会话内功能仍可用
      }
    },
    { deep: true }
  )

  /** 按年月倒序、同月按租客名排序 */
  const sortedRecords = computed(() =>
    [...records.value].sort(
      (a, b) =>
        b.year - a.year ||
        b.month - a.month ||
        a.tenant.localeCompare(b.tenant, 'zh-CN') ||
        b.updatedAt - a.updatedAt
    )
  )

  function recordsOfMonth(year: number, month: number): RentRecord[] {
    return sortedRecords.value.filter((r) => r.year === year && r.month === month)
  }

  function findById(id: string): RentRecord | undefined {
    return records.value.find((r) => r.id === id)
  }

  /** 查找同月同租客的重复记录 */
  function findDuplicate(draft: RecordDraft, excludeId?: string): RentRecord | undefined {
    const tenant = draft.tenant.trim()
    return records.value.find(
      (r) =>
        r.id !== excludeId &&
        r.year === draft.year &&
        r.month === draft.month &&
        r.tenant.trim() === tenant
    )
  }

  /** 新增或更新一条记录 */
  function saveRecord(draft: RecordDraft, id?: string): RentRecord {
    const normalized: RecordDraft = {
      ...draft,
      tenant: draft.tenant.trim(),
      note: draft.note.trim()
    }

    if (id) {
      const index = records.value.findIndex((r) => r.id === id)
      if (index === -1) throw new Error('记录不存在')
      const updated: RentRecord = {
        ...records.value[index],
        ...normalized,
        updatedAt: Date.now()
      }
      records.value.splice(index, 1, updated)
      return updated
    }

    const now = Date.now()
    const record: RentRecord = { id: genId(), ...normalized, createdAt: now, updatedAt: now }
    records.value.push(record)
    return record
  }

  function removeRecord(id: string): void {
    records.value = records.value.filter((r) => r.id !== id)
  }

  function togglePaid(id: string): void {
    const record = findById(id)
    if (record) {
      record.paid = !record.paid
      record.updatedAt = Date.now()
    }
  }

  function summarize(list: RentRecord[]): PeriodSummary {
    const total = list.reduce((sum, r) => sum + recordTotal(r), 0)
    const paid = list.filter((r) => r.paid).reduce((sum, r) => sum + recordTotal(r), 0)
    return { count: list.length, total, paid, unpaid: total - paid }
  }

  function monthSummary(year: number, month: number): PeriodSummary {
    return summarize(recordsOfMonth(year, month))
  }

  function yearSummary(year: number): PeriodSummary {
    return summarize(sortedRecords.value.filter((r) => r.year === year))
  }

  /** 某一年各费用项的合计 */
  function feeTotals(year: number): Record<FeeKey, number> {
    const totals: Record<FeeKey, number> = {
      rent: 0,
      water: 0,
      electricity: 0,
      gas: 0,
      garbage: 0
    }
    for (const r of records.value) {
      if (r.year !== year) continue
      for (const key of Object.keys(totals) as FeeKey[]) {
        totals[key] += r[key]
      }
    }
    return totals
  }

  /** 有记录的年份（含当前年份），倒序 */
  function availableYears(): number[] {
    const set = new Set(records.value.map((r) => r.year))
    set.add(new Date().getFullYear())
    return [...set].sort((a, b) => b - a)
  }

  return {
    records,
    sortedRecords,
    recordsOfMonth,
    findById,
    findDuplicate,
    saveRecord,
    removeRecord,
    togglePaid,
    monthSummary,
    yearSummary,
    feeTotals,
    availableYears
  }
})
