/**
 * 表盘数字识别：动态加载 tesseract.js（jsDelivr CDN），
 * 全部在浏览器本地完成，照片不会上传到任何服务器。
 */

interface TesseractWorkerLike {
  setParameters: (params: Record<string, string>) => Promise<unknown>
  recognize: (image: string) => Promise<{ data: { text: string } }>
}

interface TesseractLike {
  createWorker: (
    lang: string,
    oem?: number,
    options?: { logger?: (m: { status?: string; progress?: number }) => void }
  ) => Promise<TesseractWorkerLike>
}

declare global {
  interface Window {
    Tesseract?: TesseractLike
  }
}

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('识别组件加载失败，请检查网络'))
    document.head.appendChild(script)
  })
}

let workerPromise: Promise<TesseractWorkerLike> | null = null

async function getWorker(): Promise<TesseractWorkerLike> {
  if (!window.Tesseract) {
    await loadScript(TESSERACT_CDN)
  }
  if (!window.Tesseract) throw new Error('识别组件加载失败')

  if (!workerPromise) {
    workerPromise = window.Tesseract.createWorker('eng', 1).then(async (worker) => {
      // 表盘只需要数字和小数点，限定字符集可提升准确率
      await worker.setParameters({ tessedit_char_whitelist: '0123456789.' })
      return worker
    })
  }
  return workerPromise
}

/** 从识别文本里提取最长的数字（表盘读数通常位数最多） */
function extractNumber(text: string): string {
  const matches = text.replace(/\s/g, '').match(/\d+(?:\.\d+)?/g)
  if (!matches || matches.length === 0) return ''
  return [...matches].sort((a, b) => b.length - a.length)[0] ?? ''
}

/** 识别照片中的表盘读数，返回数字字符串（可能为空，需人工核对） */
export async function recognizeDigits(dataUrl: string): Promise<string> {
  const worker = await getWorker()
  const { data } = await worker.recognize(dataUrl)
  return extractNumber(data.text)
}
