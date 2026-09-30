import {
  FEE_META,
  calcMeterUsage,
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
  /** 水气误差弥补（元，仅在合计中扣一次；0 = 不显示） */
  allowance: number
  /** 停车开门弥补费（元；0 = 不显示） */
  parkingFee: number
  total: string
  paid: boolean
  note: string
}

/** 抄表照片项 */
export interface BillPhotoItem {
  /** 如：💧 水表 */
  caption: string
  src: string
}

/** 抄表照片分组 */
export interface BillPhotoGroup {
  title: string
  photos: BillPhotoItem[]
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

  return {
    title: `${record.year}年${record.month}月 房租账单`,
    tenantLine: `租客：${record.tenant}`,
    fees,
    allowance: record.waterGasAllowance ?? 0,
    parkingFee: record.parkingFee ?? 0,
    total: formatYuan(recordTotal(record)),
    paid: record.paid,
    note: record.note.trim()
  }
}

/* ==================== Canvas 绘制 ==================== */

const SCALE = 2
const W = 600

const FONT_STACK =
  '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
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

/* 照片区尺寸：固定 水/电/气 三列，缺图显示「暂无」占位 */
const PHOTO_COLS = 3
const PHOTO_COL_GAP = 14
const PHOTO_CAPTION_H = 24
const PHOTO_CELL_H = 150
const PHOTO_ROW_GAP = 16
const PHOTO_ROW_H = PHOTO_CAPTION_H + PHOTO_CELL_H + PHOTO_ROW_GAP // 160
const PHOTO_GROUP_TITLE_H = 44
const PHOTOS_HEADER_H = 48
const PHOTOS_DIVIDER_H = 30

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/** 居中裁剪填满格子（cover）：无拉伸、无留白，表盘居中时最清晰 */
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

/** 计算照片区高度（每组固定三列，一排展示） */
function photosSectionHeight(groups: BillPhotoGroup[]): number {
  if (groups.length === 0) return 0
  let h = PHOTOS_DIVIDER_H + PHOTOS_HEADER_H
  for (const group of groups) {
    h += PHOTO_GROUP_TITLE_H + Math.ceil(group.photos.length / PHOTO_COLS) * PHOTO_ROW_H
  }
  return h
}

/** 缺失照片的「暂无」占位框 */
function drawPhotoPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  ctx.save()
  roundRect(ctx, x, y, w, h, 10)
  ctx.fillStyle = '#f5f6f8'
  ctx.fill()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#d9dce1'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()

  ctx.fillStyle = '#c0c4cc'
  ctx.font = F_DETAIL
  ctx.textAlign = 'center'
  ctx.fillText('暂无', x + w / 2, y + h / 2 + 7)
}

/** 把账单绘制成 PNG 截图（纯前端，无网络依赖），可附带抄表照片 */
export async function renderBillImage(
  record: RentRecord,
  photoGroups: BillPhotoGroup[] = []
): Promise<Blob> {
  const data = buildBillData(record)

  // 预加载全部照片（空地址 = 缺图占位，跳过加载）
  const loadedImages = new Map<string, HTMLImageElement>()
  await Promise.all(
    photoGroups.flatMap((group) =>
      group.photos.map(async (item) => {
        if (item.src && !loadedImages.has(item.src)) {
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
  const CELL_W = Math.floor((CARD_W - P * 2 - PHOTO_COL_GAP * (PHOTO_COLS - 1)) / PHOTO_COLS)

  const HEADER_H = 118
  const FEES_TOP_GAP = 30
  const TOTAL_SECTION_H = 92

  const noteLines = data.note ? wrapText(mctx, data.note, CARD_W - P * 2 - 24, F_NOTE) : []
  const hasNote = noteLines.length > 0
  const noteBoxH = hasNote ? 20 + noteLines.length * 34 + 16 : 0
  const noteH = hasNote ? noteBoxH + 20 : 0

  const feesH =
    (data.fees.length
      ? data.fees.reduce((sum, fee) => sum + (fee.detail ? 96 : 62), 0)
      : 52) +
      (data.allowance > 0 ? 52 : 0) +
      (data.parkingFee > 0 ? 52 : 0)

  const photosH = photosSectionHeight(photoGroups)
  const FOOTER_H = 66
  const H =
    16 + HEADER_H + FEES_TOP_GAP + feesH + TOTAL_SECTION_H + noteH + photosH + FOOTER_H

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

  // ===== 费用明细 =====
  let y = 16 + HEADER_H + FEES_TOP_GAP
  if (data.fees.length === 0) {
    ctx.fillStyle = '#969799'
    ctx.font = F_DETAIL
    ctx.textAlign = 'left'
    ctx.fillText('（本月暂无费用明细）', CARD_X + P, y + 30)
  } else {
    for (const fee of data.fees) {
      ctx.fillStyle = '#323233'
      ctx.font = F_LABEL
      ctx.textAlign = 'left'
      ctx.fillText(`${fee.emoji} ${fee.label}`, CARD_X + P, y + 34)

      ctx.fillStyle = '#323233'
      ctx.font = F_AMOUNT
      ctx.textAlign = 'right'
      ctx.fillText(fee.amount, CARD_X + CARD_W - P, y + 34)

      if (fee.detail) {
        ctx.fillStyle = '#969799'
        ctx.font = F_DETAIL
        ctx.textAlign = 'left'
        ctx.fillText(fee.detail, CARD_X + P, y + 68)
      }
      y += fee.detail ? 96 : 62
    }
  }

  // ===== 停车开门弥补费 =====
  if (data.parkingFee > 0) {
    ctx.fillStyle = '#323233'
    ctx.font = F_LABEL
    ctx.textAlign = 'left'
    ctx.fillText('🅿️ 停车开门弥补', CARD_X + P, y + 34)
    ctx.fillStyle = '#d48806'
    ctx.font = F_AMOUNT
    ctx.textAlign = 'right'
    ctx.fillText(`-${formatYuan(data.parkingFee)}`, CARD_X + CARD_W - P, y + 34)
    y += 52
  }

  // ===== 水气误差弥补（只在合计扣一次） =====
  if (data.allowance > 0) {
    ctx.fillStyle = '#969799'
    ctx.font = F_LABEL
    ctx.textAlign = 'left'
    ctx.fillText('⚖️ 水气误差弥补', CARD_X + P, y + 34)
    ctx.fillStyle = '#d48806'
    ctx.font = F_AMOUNT
    ctx.textAlign = 'right'
    ctx.fillText(`-${formatYuan(data.allowance)}`, CARD_X + CARD_W - P, y + 34)
    y += 52
  }

  // ===== 合计 =====
  dashedLine(ctx, CARD_X + P, y + 12, CARD_X + CARD_W - P, '#e5e7eb')
  const totalBaseline = y + 12 + 26 + 40
  ctx.fillStyle = '#969799'
  ctx.font = F_TOTAL_LABEL
  ctx.textAlign = 'left'
  ctx.fillText('合计', CARD_X + P, totalBaseline)
  ctx.fillStyle = '#0ba360'
  ctx.font = F_TOTAL
  ctx.textAlign = 'right'
  ctx.fillText(data.total, CARD_X + CARD_W - P, totalBaseline)
  y += TOTAL_SECTION_H

  // ===== 备注 =====
  if (hasNote) {
    roundRect(ctx, CARD_X + P - 8, y, CARD_W - (P - 8) * 2, noteBoxH, 12)
    ctx.fillStyle = '#f7f8fa'
    ctx.fill()
    ctx.fillStyle = '#6b7280'
    ctx.font = F_NOTE
    ctx.textAlign = 'left'
    let ny = y + 20 + 24
    for (const line of noteLines) {
      ctx.fillText(line, CARD_X + P + 4, ny)
      ny += 34
    }
    y += noteH
  }

  // ===== 抄表照片 =====
  if (photoGroups.length > 0) {
    dashedLine(ctx, CARD_X + P, y + 8, CARD_X + CARD_W - P, '#e5e7eb')
    y += PHOTOS_DIVIDER_H

    ctx.fillStyle = '#323233'
    ctx.font = F_LABEL
    ctx.textAlign = 'left'
    ctx.fillText('📷 抄表照片', CARD_X + P, y + 30)
    y += PHOTOS_HEADER_H

    for (const group of photoGroups) {
      ctx.fillStyle = '#969799'
      ctx.font = F_DETAIL
      ctx.textAlign = 'left'
      ctx.fillText(group.title, CARD_X + P, y + 26)
      y += PHOTO_GROUP_TITLE_H

      // 每组固定三列（水/电/气），缺图用「暂无」占位，位置永不错乱
      for (let c = 0; c < group.photos.length && c < PHOTO_COLS; c++) {
        const item = group.photos[c]!
        const x = CARD_X + P + c * (CELL_W + PHOTO_COL_GAP)
        ctx.fillStyle = '#969799'
        ctx.font = F_DETAIL
        ctx.textAlign = 'left'
        ctx.fillText(item.caption, x, y + 18)
        const img = item.src ? loadedImages.get(item.src) : undefined
        if (img) {
          drawImageCover(ctx, img, x, y + PHOTO_CAPTION_H, CELL_W, PHOTO_CELL_H)
        } else {
          drawPhotoPlaceholder(ctx, x, y + PHOTO_CAPTION_H, CELL_W, PHOTO_CELL_H)
        }
      }
      y += PHOTO_ROW_H
    }
  }

  // ===== 页脚 =====
  ctx.fillStyle = '#969799'
  ctx.font = F_FOOTER
  ctx.textAlign = 'center'
  ctx.fillText('请核对，如有疑问随时联系～', W / 2, H - 26)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('生成截图失败'))),
      'image/png'
    )
  })
}
