/** 金额格式化为人民币，最多保留两位小数 */
export function formatYuan(value: number): string {
  const text = value.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })
  return `¥${text}`
}
