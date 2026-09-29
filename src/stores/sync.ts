import { computed, nextTick, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { useRentStore, isRentRecord } from '@/stores/rent'
import type { RentRecord } from '@/types'
import { base64ToUtf8, utf8ToBase64 } from '@/utils/base64'

const SYNC_CONFIG_KEY = 'zyj-collect-rent:sync:v1'
const AUTO_PUSH_DELAY_MS = 3000
/** 回到页面时自动拉取的最小间隔 */
const VISIBILITY_PULL_INTERVAL_MS = 5 * 60 * 1000

/** GitHub 云同步配置（Token 仅保存在本机浏览器，不会打进构建产物） */
export interface SyncConfig {
  /** GitHub 用户名 */
  owner: string
  /** 存数据的仓库名（建议私有仓库） */
  repo: string
  /** 分支名，默认 main */
  branch: string
  /** 仓库内的 JSON 文件路径 */
  path: string
  /** Fine-grained Personal Access Token（仅需该仓库 Contents 读写权限） */
  token: string
  /** 修改记录后自动上传 */
  autoPush: boolean
  lastSyncAt?: number | null
}

interface GitHubContentResponse {
  sha?: unknown
  content?: unknown
}

const DEFAULT_CONFIG: SyncConfig = {
  owner: '',
  repo: '',
  branch: 'main',
  path: 'data/records.json',
  token: '',
  autoPush: false,
  lastSyncAt: null
}

function loadConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(raw) as Partial<SyncConfig>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function persistConfig(config: SyncConfig): void {
  try {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // 存储不可用时忽略
  }
}

function isConfigValid(config: SyncConfig): boolean {
  return Boolean(
    config.owner.trim() &&
      config.repo.trim() &&
      config.branch.trim() &&
      config.path.trim() &&
      config.token.trim()
  )
}

function apiUrl(config: SyncConfig): string {
  const path = config.path.trim().replace(/^\/+/, '')
  return `https://api.github.com/repos/${encodeURIComponent(
    config.owner.trim()
  )}/${encodeURIComponent(config.repo.trim())}/contents/${encodeURI(path)}`
}

function authHeaders(config: SyncConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token.trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  }
}

interface RemoteFile {
  sha: string | null
  content: string
}

/** 拉取云端 JSON 文件；不存在时返回 null */
async function fetchRemote(config: SyncConfig): Promise<RemoteFile | null> {
  const url = `${apiUrl(config)}?ref=${encodeURIComponent(config.branch.trim())}`
  const res = await fetch(url, { headers: authHeaders(config), cache: 'no-store' })

  if (res.status === 404) return null
  if (res.status === 401 || res.status === 403) {
    throw new Error('Token 无效或没有权限（需勾选该仓库的 Contents: Read and write）')
  }
  if (!res.ok) {
    throw new Error(`读取云端数据失败（HTTP ${res.status}）`)
  }

  const data = (await res.json()) as GitHubContentResponse
  const sha = typeof data.sha === 'string' ? data.sha : null
  const content = typeof data.content === 'string' ? base64ToUtf8(data.content) : ''
  return { sha, content }
}

/** 解析云端 JSON，兼容 { records: [...] } 与纯数组两种格式 */
function parseRemotePayload(content: string): RentRecord[] {
  try {
    const parsed: unknown = JSON.parse(content)
    if (Array.isArray(parsed)) return parsed.filter(isRentRecord)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { records?: unknown }).records)
    ) {
      return ((parsed as { records: unknown[] }).records).filter(isRentRecord)
    }
    return []
  } catch {
    throw new Error('云端数据格式不正确，无法解析')
  }
}

async function pushRemote(
  config: SyncConfig,
  records: RentRecord[],
  sha: string | null
): Promise<void> {
  const payload = {
    version: 1,
    exportedAt: Date.now(),
    records
  }
  const body = JSON.stringify({
    message: `sync: 更新收房租数据 ${new Date().toISOString()}`,
    content: utf8ToBase64(JSON.stringify(payload, null, 2)),
    branch: config.branch.trim(),
    ...(sha ? { sha } : {})
  })

  const res = await fetch(apiUrl(config), {
    method: 'PUT',
    headers: authHeaders(config),
    body
  })

  if (res.status === 401 || res.status === 403) {
    throw new Error('Token 无效或没有权限（需勾选该仓库的 Contents: Read and write）')
  }
  if (res.status === 409) {
    throw new Error('云端刚被其他设备修改，请再同步一次合并后重试')
  }
  if (!res.ok) {
    throw new Error(`上传云端数据失败（HTTP ${res.status}）`)
  }
}

/**
 * 双向合并：按 id 对齐，updatedAt 新的一方胜出。
 * 删除通过墓碑记录（deleted=true）同步，最后操作的一方生效。
 */
function mergeRecords(local: RentRecord[], remote: RentRecord[]): RentRecord[] {
  const map = new Map<string, RentRecord>()
  for (const record of local) map.set(record.id, record)
  for (const record of remote) {
    const existing = map.get(record.id)
    if (!existing || record.updatedAt > existing.updatedAt) {
      map.set(record.id, record)
    }
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 用于比较两份记录列表是否有差异（墓碑也参与比较） */
function serializeRecords(list: RentRecord[]): string {
  return JSON.stringify([...list].sort((a, b) => a.id.localeCompare(b.id)))
}

export const useSyncStore = defineStore('sync', () => {
  const rent = useRentStore()

  const config = ref<SyncConfig>(loadConfig())
  const syncing = ref(false)
  const lastError = ref<string | null>(null)

  const configured = computed(() => isConfigValid(config.value))
  const lastSyncAt = computed(() => config.value.lastSyncAt ?? null)

  let suppressEcho = false
  let pushTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 同步核心：拉取云端 → 与本地合并（含删除墓碑）→ 按需回写。
   * forcePush=true 时无论是否有差异都上传（手动同步/自动上传共用）。
   */
  async function syncCore(forcePush: boolean): Promise<boolean> {
    const remote = await fetchRemote(config.value)
    const remoteRecords = remote ? parseRemotePayload(remote.content) : []
    const merged = mergeRecords(rent.records, remoteRecords)

    const localChanged = serializeRecords(merged) !== serializeRecords(rent.records)
    const remoteChanged = serializeRecords(merged) !== serializeRecords(remoteRecords)

    if (localChanged) {
      suppressEcho = true
      rent.replaceAll(merged)
      await nextTick()
    }

    if (forcePush || remoteChanged) {
      await pushRemote(config.value, merged, remote?.sha ?? null)
    }

    config.value = { ...config.value, lastSyncAt: Date.now() }
    persistConfig(config.value)
    return localChanged || remoteChanged
  }

  /** 手动「立即同步」：双向合并 + 强制上传 */
  async function sync(): Promise<void> {
    if (syncing.value) return
    if (!configured.value) throw new Error('请先完整填写并保存同步配置')

    syncing.value = true
    lastError.value = null
    try {
      await syncCore(true)
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : '同步失败，请检查网络与配置'
      throw error
    } finally {
      suppressEcho = false
      syncing.value = false
    }
  }

  /** 后台静默拉取：启动时 / 回到页面时调用，失败不打扰用户 */
  async function backgroundPull(): Promise<void> {
    if (syncing.value || !configured.value) return
    syncing.value = true
    try {
      await syncCore(false)
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : '后台同步失败'
    } finally {
      suppressEcho = false
      syncing.value = false
    }
  }

  /** 记录变化（增/改/删/切换已收）后的自动上传：同样先合并，绝不覆盖其他设备 */
  async function autoPush(): Promise<void> {
    if (syncing.value || !configured.value) return
    syncing.value = true
    try {
      await syncCore(true)
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : '自动同步失败'
    } finally {
      suppressEcho = false
      syncing.value = false
    }
  }

  function scheduleAutoPush(): void {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      pushTimer = null
      void autoPush()
    }, AUTO_PUSH_DELAY_MS)
  }

  // 监听本地记录变化，防抖后自动上传（开启「修改后自动同步」时生效）
  watch(
    () => rent.records,
    () => {
      if (suppressEcho || syncing.value) return
      if (!config.value.autoPush || !configured.value) return
      scheduleAutoPush()
    },
    { deep: true }
  )

  // 应用启动后自动从云端拉取最新数据（静默合并）
  setTimeout(() => {
    void backgroundPull()
  }, 800)

  // 从其他应用切回本页面时自动刷新云端数据（5 分钟内不重复拉取）
  function handleVisibilityChange(): void {
    if (document.visibilityState !== 'visible') return
    if (!configured.value) return
    const last = config.value.lastSyncAt ?? 0
    if (Date.now() - last < VISIBILITY_PULL_INTERVAL_MS) return
    void backgroundPull()
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)

  function updateConfig(patch: Partial<Omit<SyncConfig, 'lastSyncAt'>>): void {
    config.value = { ...config.value, ...patch }
    persistConfig(config.value)
  }

  return {
    config,
    configured,
    syncing,
    lastSyncAt,
    lastError,
    sync,
    updateConfig
  }
})
