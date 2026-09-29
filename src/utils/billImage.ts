import {
  FEE_META,
  calcMeterUsage,
  houseTypeMeta,
  meterFormulaText,
  meterInfoOf,
  recordTotal,
  type FeeMeta,
  type RentRecord
} from '@/types'
import { formatYuan } from '@/utils/format'

/** 账单图片数据 */
export interface BillFeeLine {
  emoji: string
  label: string
  amount: string
  detail?: string
}

export interface BillData {
  title: string
  tenantLine: string
  fees: BillFeeLine[]
  total: string
  paid: boolean
  note: string
}

const METER_UNIT: Record<string, string> = {
  water: '吨',
  electricity: '度',
  gas: 'm³'
}

/** 组装账单数据（文字版 / 截图版共用） */
export function buildBillData(record: RentRecord): BillData {
  const fees: BillFeeLine[] = FEE_META.filter((meta) => record[meta.key] > 0).map(
    (meta: FeeMeta) => {
      const meter = meterInfoOf(record, meta.key)
      const formula = meter ? meterFormulaText(meter) : ''
      const usage = meter ? calcMeterUsage(meter) : null
      const unit = METER_UNIT[meta.key] ?? ''
      const detail =
        formula && usage != null ? `${formula}，用量 ${usage}${unit}` : formula
      return {
        emoji: meta.emoji,
        label: meta.label,
        amount: formatYuan(record[meta.key]),
        ...(detail ? { detail } : {})
      }
    }
  )

  const type = houseTypeMeta(record.houseType)
  return {
    title: `${record.year}年${record.month}月 房租账单`,
    tenantLine: `租客：${record.tenant}${type ? `（${type.label}）` : ''}`,
    fees,
    total: formatYuan(recordTotal(record)),
    paid: record.paid,
    note: record.note.trim()
  }
}

/* ==================== Canvas 绘制 ==================== */

const SCALE = 2
const W = 600

const FONT_STACK = '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const F_TITLE = `700 30px ${FONT_STACK}`
const F_SUB = `400 22px ${FONT_STACK}`
const F_LABEL = `500 26px ${FONT_STACK}`
const F_AMOUNT = `700 26px ${FONT_STACK}`
const F_DETAIL = `400 20px ${FONT_STACK}`
const F_TOTAL_LABEL = `400 26px ${FONT_STACK}`
const F_TOTAL = `800 38px ${FONT_STACK}`
const F_NOTE = `400 22px ${FONT_STACK}`
const F_FOOTER = `400 20px ${FONT_STACK}`
const F_BADGE = `600 22px ${FONT_STACK}`

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string
): string[] {
  ctx.font = font
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

function dashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y: number,
  x2: number,
  color: string
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([6, 6])
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  ctx.restore()
}

/** 抄表照片项 */
export interface BillPhotoItem {
  /** 如：💧 水表 · 本次 */
  caption: string
  /** 图片 dataURL */
  src: string
}

/** 抄表照片分组 */
export interface BillPhotoGroup {
  /** 如：⬆️ 楼上抄表照片 */
  title: string
  photos: BillPhotoItem[]
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/** 按封面模式把图片绘制进圆角单元格 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const scale = Math.max(w / img.width, h / img.height)
  const sw = w / scale
  const sh = h / scale
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  ctx.save()
  roundRect(ctx, x, y, w, h, 10)
  ctx.clip()
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
  ctx.restore()
  ctx.save()
  roundRect(ctx, x, y, w, h, 10)
  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

const PHOTO_CELL_H = 185
const PHOTO_GAP = 14

/** 计算照片区高度（不含分割线） */
function photosSectionHeight(groups: BillPhotoGroup[]): number {
  if (groups.length === 0) return 0
  let h = 44 // 「抄表照片」标题
  for (const group of groups) {
    const rows = Math.ceil(group.photos.length / 2)
    h += 40 + rows * (24 + PHOTO_CELL_H + 16)
  }
  return h + 30 // 分割线区域
}

/** 把账单绘制成 PNG 截图（纯前端，无网络依赖），可附带抄表照片 */
export async function renderBillImage(
  record: RentRecord,
  photoGroups: BillPhotoGroup[] = []
): Promise<Blob> {
  const data = buildBillData(record)

  // 预加载全部照片
  const loadedImages = new Map<string, HTMLImageElement>()
  await Promise.all(
    photoGroups.flatMap((g) =>
      g.photos.map(async (item) => {
        if (!loadedImages.has(item.src)) {
          loadedImages.set(item.src, await loadImage(item.src))
        }
      })
    )
  )

  const measureCanvas = document.createElement('canvas')
  const mctx = measureCanvas.getContext('2d')
  if (!mctx) throw new Error('canvas 不可用')

  const CARD_X = 16
  const CARD_W = W - 32
  const P = 30
  const HEADER_H = 118

  const noteLines = data.note ? wrapText(mctx, data.note, CARD_W - P * 2 - 24, F_NOTE) : []
  const hasNote = noteLines.length > 0

  const feeRowH = (fee: BillFeeLine) => (fee.detail ? 96 : 62)
  const feesH = data.fees.length
    ? data.fees.reduce((sum, fee) => sum + feeRowH(fee), 0)
    : 52

  const TOTAL_H = 78
  const FOOTER_H = 66
  const NOTE_H = hasNote ? 24 + noteLines.length * 34 + 24 : 0
  const CELL_W = Math.floor((CARD_W - P * 2 - PHOTO_GAP) / 2)
  const PHOTOS_H = photosSectionHeight(photoGroups)

  const H =
    16 +
    HEADER_H +
    26 +
    feesH +
    18 +
    TOTAL_H +
    20 +
    NOTE_H +
    PHOTOS_H +
    FOOTER_H +
    16

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  ctx.scale(SCALE, SCALE)

  // 背景 + 白色圆角卡片
  ctx.fillStyle = '#eef2f5'
  ctx.fillRect(0, 0, W, H)
  roundRect(ctx, CARD_X, 16, CARD_W, H - 32, 24)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  // 顶部渐变头部（底部直角）
  const grad = ctx.createLinearGradient(CARD_X, 16, CARD_X + CARD_W, 16 + HEADER_H)
  grad.addColorStop(0, '#0ba360')
  grad.addColorStop(1, '#3cba92')
  ctx.fillStyle = grad
  roundRect(ctx, CARD_X, 16, CARD_W, HEADER_H, 24)
  ctx.fill()
  ctx.fillRect(CARD_X, 16 + HEADER_H - 24, CARD_W, 24)

  // 头部文字
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.font = F_TITLE
  ctx.fillText(data.title, CARD_X + P, 16 + 48)
  ctx.font = F_SUB
  ctx.globalAlpha = 0.92
  ctx.fillText(data.tenantLine, CARD_X + P, 16 + 88)
  ctx.globalAlpha = 1

  // 收款状态徽标（右上）
  const badgeText = data.paid ? '已收款' : '待收款'
  ctx.font = F_BADGE
  const badgeW = ctx.measureText(badgeText).width + 30
  roundRect(ctx, CARD_X + CARD_W - P - badgeW, 16 + 34, badgeW, 40, 20)
  ctx.fillStyle = data.paid ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.24)'
  ctx.fill()
  ctx.fillStyle = data.paid ? '#0ba360' : '#ffffff'
  ctx.textAlign = 'center'
  ctx.fillText(badgeText, CARD_X + CARD_W - P - badgeW / 2, 16 + 34 + 27)

  // 费用明细
  let y = 16 + HEADER_H + 26 + 34
  if (data.fees.length === 0) {
    ctx.fillStyle = '#969799'
    ctx.font = F_DETAIL
    ctx.textAlign = 'left'
    ctx.fillText('（本月暂无费用明细）', CARD_X + P, y)
    y += 24
  } else {
    for (const fee of data.fees) {
      ctx.fillStyle = '#323233'
      ctx.font = F_LABEL
      ctx.textAlign = 'left'
      ctx.fillText(`${fee.emoji} ${fee.label}`, CARD_X + P, y)

      ctx.fillStyle = '#323233'
      ctx.font = F_AMOUNT
      ctx.textAlign = 'right'
      ctx.fillText(fee.amount, CARD_X + CARD_W - P, y)

      if (fee.detail) {
        ctx.fillStyle = '#969799'
        ctx.font = F_DETAIL
        ctx.textAlign = 'left'
        ctx.fillText(fee.detail, CARD_X + P, y + 34)
        y += feeRowH(fee)
      } else {
        y += feeRowH(fee)
      }
    }
  }

  // 分割线 + 合计
  dashedLine(ctx, CARD_X + P, y + 6, CARD_X + CARD_W - P, '#e5e7eb')
  y += 6 + TOTAL_H - 18
  ctx.fillStyle = '#969799'
  ctx.font = F_TOTAL_LABEL
  ctx.textAlign = 'left'
  ctx.fillText('合计', CARD_X + P, y)
  ctx.fillStyle = '#0ba360'
  ctx.font = F_TOTAL
  ctx.textAlign = 'right'
  ctx.fillText(data.total, CARD_X + CARD_W - P, y)
  y += 20

  // 备注
  if (hasNote) {
    const boxH = 24 + noteLines.length * 34 + 16
    roundRect(ctx, CARD_X + P - 8, y, CARD_W - (P - 8) * 2, boxH, 12)
    ctx.fillStyle = '#f7f8fa'
    ctx.fill()
    ctx.fillStyle = '#6b7280'
    ctx.font = F_NOTE
    ctx.textAlign = 'left'
    let ny = y + 24 + 22
    for (const line of noteLines) {
      ctx.fillText(line, CARD_X + P + 4, ny)
      ny += 34
    }
    y += boxH + 20
  }

  // 抄表照片区
  if (photoGroups.length > 0) {
    dashedLine(ctx, CARD_X + P, y + 4, CARD_X + CARD_W - P, '#e5e7eb')
    y += 34
    ctx.fillStyle = '#323233'
    ctx.font = F_LABEL
    ctx.textAlign = 'left'
    ctx.fillText('📷 抄表照片', CARD_X + P, y)
    y += 44

    for (const group of photoGroups) {
      ctx.fillStyle = '#4f7cff'
      ctx.font = F_DETAIL
      ctx.textAlign = 'left'
      ctx.fillText(group.title, CARD_X + P, y)
      y += 30

      for (let i = 0; i < group.photos.length; i += 2) {
        const rowItems = group.photos.slice(i, i + 2)
        for (let c = 0; c < rowItems.length; c++) {
          const item = rowItems[c]!
          const x = CARD_X + P + c * (CELL_W + PHOTO_GAP)
          ctx.fillStyle = '#969799'
          ctx.font = F_DETAIL
          ctx.textAlign = 'left'
          ctx.fillText(item.caption, x, y + 18)
          const img = loadedImages.get(item.src)
          if (img) {
            drawImageCover(ctx, img, x, y + 26, CELL_W, PHOTO_CELL_H)
          }
        }
        y += 24 + PHOTO_CELL_H + 16
      }
      y += 0
    }
  }

  // 页脚
  ctx.fillStyle = '#b7bdc8'
  ctx.font = F_FOOTER
  ctx.textAlign = 'center'
  const date = new Date().toLocaleString('zh-CN', { hour12: false })
  ctx.fillText(`由「收房租」生成 · ${date}`, W / 2, H - 16 - 24)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('生成截图失败'))),
      'image/png'
    )
  })
}
