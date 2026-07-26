// 基于 localStorage 的截图存储
const KEYS = {
  rock: 'rps_snapshot_rock',
  paper: 'rps_snapshot_paper',
  scissors: 'rps_snapshot_scissors'
}

export const GESTURES = ['rock', 'paper', 'scissors']

export function getSnapshot(gesture) {
  const v = localStorage.getItem(KEYS[gesture])
  // 仅返回有效截图（data URL），过滤误存的 "null" 等无效值
  return v && v.startsWith('data:') ? v : null
}

export function saveSnapshot(gesture, dataUrl) {
  // 仅保存有效截图，避免空值覆盖已有数据
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return
  localStorage.setItem(KEYS[gesture], dataUrl)
}

export function clearSnapshots() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k))
}

export function hasTrained() {
  return GESTURES.every((g) => !!getSnapshot(g))
}
