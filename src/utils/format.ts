/** 金额格式化为人民币，最多保留两位小数 */
export function formatYuan(value: number): string {
  const text = value.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })
  return `¥${text}`
}

/** 时间格式化（云同步状态用） */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}
