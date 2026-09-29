import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import type { FeeKey, HouseType, MeterInfo, MeterKey, RentRecord } from '@/types'
import { recordTotal } from '@/types'
import { genId } from '@/utils/id'

const STORAGE_KEY = 'zyj-collect-rent:records:v1'

/** 新增/编辑时的表单数据 */
export interface RecordDraft {
  year: number
  month: number
  houseType: HouseType
  tenant: string
  rent: number
  water: number
  electricity: number
  gas: number
  garbage: number
  note: string
  paid: boolean
  meters?: Partial<Record<MeterKey, MeterInfo>>
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

/** 从 localStorage / 云端读取时做一次结构校验，防止脏数据 */
export function isRentRecord(value: unknown): value is RentRecord {
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

  /** 按年月倒序、同月按租客名排序（只包含未删除记录，墓碑仅用于同步） */
  const sortedRecords = computed(() =>
    [...records.value].filter((r) => !r.deleted).sort(
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

  /**
   * 查询同房屋类型（楼上/楼下）在指定月份之前、最近一次的抄表数据，
   * 与租客姓名无关。用于自动带出「上次读数」。
   */
  function findPrevMeter(
    houseType: HouseType,
    year: number,
    month: number,
    meter: MeterKey
  ): MeterInfo | undefined {
    return sortedRecords.value.find(
      (r) =>
        !r.deleted &&
        r.houseType === houseType &&
        (r.year < year || (r.year === year && r.month < month)) &&
        r.meters?.[meter]?.currentReading != null
    )?.meters?.[meter]
  }

  /** 查询某房屋类型在指定年月的最新一条记录（如：楼下带出楼上本月读数） */
  function findLatestHouseRecord(
    houseType: HouseType,
    year: number,
    month: number
  ): RentRecord | undefined {
    const list = [...records.value]
      .filter(
        (r) => !r.deleted && r.houseType === houseType && r.year === year && r.month === month
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return list.length > 0 ? list[0] : undefined
  }

  /** 查询同房屋类型在指定月份之前、最近一次的完整记录（用于带出「上次」抄表照片） */
  function findPrevHouseRecord(
    houseType: HouseType,
    year: number,
    month: number
  ): RentRecord | undefined {
    const list = [...records.value]
      .filter(
        (r) =>
          !r.deleted &&
          r.houseType === houseType &&
          (r.year < year || (r.year === year && r.month < month))
      )
      .sort((a, b) => b.year - a.year || b.month - a.month || b.updatedAt - a.updatedAt)
    return list.length > 0 ? list[0] : undefined
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
        !r.deleted &&
        r.houseType === draft.houseType &&
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

  /** 云同步合并后整体替换本地数据 */
  function replaceAll(list: RentRecord[]): void {
    records.value = list
  }

  /**
   * 删除记录（软删除）：
   * 保留墓碑记录用于云端同步，其他设备同步后该条也会被标记删除；
   * 所有界面读取都经过 sortedRecords / recordsOfMonth 过滤，用户无感知。
   */
  function removeRecord(id: string): void {
    const record = findById(id)
    if (!record) return
    record.deleted = true
    record.deletedAt = Date.now()
    record.updatedAt = Date.now()
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
      if (r.year !== year || r.deleted) continue
      for (const key of Object.keys(totals) as FeeKey[]) {
        totals[key] += r[key]
      }
    }
    return totals
  }

  /** 有记录的年份（含当前年份），倒序 */
  function availableYears(): number[] {
    const set = new Set(records.value.filter((r) => !r.deleted).map((r) => r.year))
    set.add(new Date().getFullYear())
    return [...set].sort((a, b) => b - a)
  }

  return {
    records,
    sortedRecords,
    recordsOfMonth,
    findPrevMeter,
    findPrevHouseRecord,
    findLatestHouseRecord,
    findById,
    findDuplicate,
    saveRecord,
    removeRecord,
    replaceAll,
    togglePaid,
    monthSummary,
    yearSummary,
    feeTotals,
    availableYears
  }
})
