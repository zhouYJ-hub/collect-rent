import {
  FEE_META,
  METER_META,
  calcMeterUsage,
  houseTypeMeta,
  meterFormulaText,
  meterInfoOf,
  recordTotal,
  type RentRecord
} from '@/types'
import { formatYuan } from '@/utils/format'

/** 生成发给租客的文字账单 */
export function buildBillText(record: RentRecord): string {
  const lines: string[] = []
  lines.push(`🏠 ${record.year}年${record.month}月 房租账单`)

  if (record.tenant.trim()) {
    const type = houseTypeMeta(record.houseType)
    lines.push(`租客：${record.tenant.trim()}${type ? `（${type.label}）` : ''}`)
  }
  lines.push('')

  const fees = FEE_META.map((meta) => ({ ...meta, value: record[meta.key] }))
  const visible = fees.filter((fee) => fee.value > 0)

  if (visible.length > 0) {
    for (const fee of visible) {
      const meter = meterInfoOf(record, fee.key)
      const formula = meter ? meterFormulaText(meter) : ''
      const usage = meter ? calcMeterUsage(meter) : null
      const unit = METER_META.find((m) => m.feeKey === fee.key)?.unit ?? ''
      const usageText = usage != null ? `，用量 ${usage}${unit}` : ''
      lines.push(
        formula
          ? `${fee.emoji} ${fee.label}：${formatYuan(fee.value)}（${formula}${usageText}）`
          : `${fee.emoji} ${fee.label}：${formatYuan(fee.value)}`
      )
    }
  } else {
    lines.push('（本月暂无费用明细）')
  }

  lines.push('')
  if (record.parkingFee && record.parkingFee > 0) {
    lines.push(`🅿️ 停车开门弥补：${formatYuan(record.parkingFee)}`)
  }
  if (record.waterGasAllowance && record.waterGasAllowance > 0) {
    lines.push(`⚖️ 水气误差弥补：-${formatYuan(record.waterGasAllowance)}`)
  }
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
