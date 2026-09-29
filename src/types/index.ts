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
