import { FEE_META, recordTotal, type RentRecord } from '@/types'
import { formatYuan } from '@/utils/format'

/** 生成发给租客的文字账单 */
export function buildBillText(record: RentRecord): string {
  const lines: string[] = []
  lines.push(`🏠 ${record.year}年${record.month}月 房租账单`)

  if (record.tenant.trim()) {
    lines.push(`租客：${record.tenant.trim()}`)
  }
  lines.push('')

  const fees = FEE_META.map((meta) => ({ ...meta, value: record[meta.key] }))
  const visible = fees.filter((fee) => fee.value > 0)

  if (visible.length > 0) {
    for (const fee of visible) {
      lines.push(`${fee.emoji} ${fee.label}：${formatYuan(fee.value)}`)
    }
  } else {
    lines.push('（本月暂无费用明细）')
  }

  lines.push('')
  lines.push(`💰 合计：${formatYuan(recordTotal(record))}`)
  lines.push(record.paid ? '✅ 状态：已收款' : '⏳ 状态：待收款')

  if (record.note.trim()) {
    lines.push('')
    lines.push(`📝 备注：${record.note.trim()}`)
  }

  lines.push('')
  lines.push('请核对，如有疑问随时联系～')
  return lines.join('\n')
}
