/** 水电气表的抄表数据 */
export interface MeterInfo {
  /** 上次读数 */
  lastReading?: number
  /** 本次读数 */
  currentReading?: number
  /** 单价（元） */
  unitPrice?: number
  /** 抄表照片（压缩后的 dataURL） */
  photo?: string
}

export type MeterKey = 'water' | 'electricity' | 'gas'

export interface MeterMetaItem {
  key: MeterKey
  /** 表名 */
  label: string
  /** 费用名 */
  feeLabel: string
  emoji: string
  /** 计量单位 */
  unit: string
  feeKey: FeeKey
  priceHint: string
}

/** 支持抄表计算的三个表 */
export const METER_META: MeterMetaItem[] = [
  { key: 'water', label: '水表', feeLabel: '水费', emoji: '💧', unit: '吨', feeKey: 'water', priceHint: '如 3.5 元/吨' },
  { key: 'electricity', label: '电表', feeLabel: '电费', emoji: '⚡', unit: '度', feeKey: 'electricity', priceHint: '如 1.0 元/度' },
  { key: 'gas', label: '燃气表', feeLabel: '燃气费', emoji: '🔥', unit: 'm³', feeKey: 'gas', priceHint: '如 2.8 元/m³' }
]

/** 按读数计算费用：(本次 - 上次) × 单价；信息不全或本次<上次返回 null */
export function calcMeterFee(info: MeterInfo): number | null {
  if (info.lastReading == null || info.currentReading == null || info.unitPrice == null) {
    return null
  }
  if (info.currentReading < info.lastReading) return null
  return Math.round((info.currentReading - info.lastReading) * info.unitPrice * 100) / 100
}

/** 取某项费用对应的抄表数据（房租/垃圾费返回 undefined） */
export function meterInfoOf(record: RentRecord, feeKey: FeeKey): MeterInfo | undefined {
  if (feeKey === 'water' || feeKey === 'electricity' || feeKey === 'gas') {
    return record.meters?.[feeKey]
  }
  return undefined
}

/** 公式文本，如 (862 - 820) × 3.5 */
export function meterFormulaText(info: MeterInfo): string {
  return `(${fmtNum(info.currentReading)} - ${fmtNum(info.lastReading)}) × ${fmtNum(info.unitPrice)}`
}

function fmtNum(value: number | undefined): string {
  return value == null ? '' : String(value)
}

/** 一条月度收租记录 */
export interface RentRecord {
  id: string
  year: number
  month: number
  /** 租客姓名 */
  tenant: string
  /** 房租 */
  rent: number
  /** 水费 */
  water: number
  /** 电费 */
  electricity: number
  /** 燃气费 */
  gas: number
  /** 垃圾清理费 */
  garbage: number
  /** 备注 */
  note: string
  /** 是否已收款 */
  paid: boolean
  createdAt: number
  updatedAt: number
  /** 软删除标记（墓碑）：同步删除操作需要保留记录占位，界面上一律过滤 */
  deleted?: boolean
  deletedAt?: number
  /** 水电气抄表数据（读数/单价/照片） */
  meters?: Partial<Record<MeterKey, MeterInfo>>
}

export type FeeKey = 'rent' | 'water' | 'electricity' | 'gas' | 'garbage'

export interface FeeMeta {
  key: FeeKey
  label: string
  emoji: string
  color: string
}

/** 五项费用的展示配置（列表、表单、统计页共用） */
export const FEE_META: FeeMeta[] = [
  { key: 'rent', label: '房租', emoji: '🏠', color: '#f59e0b' },
  { key: 'water', label: '水费', emoji: '💧', color: '#0ea5e9' },
  { key: 'electricity', label: '电费', emoji: '⚡', color: '#8b5cf6' },
  { key: 'gas', label: '燃气费', emoji: '🔥', color: '#ef4444' },
  { key: 'garbage', label: '垃圾费', emoji: '🧹', color: '#10b981' }
]

/** 单条记录的应收合计 */
export function recordTotal(record: RentRecord): number {
  return (
    record.rent +
    record.water +
    record.electricity +
    record.gas +
    record.garbage
  )
}

export function formatMonth(year: number, month: number): string {
  return `${year}年${month}月`
}
