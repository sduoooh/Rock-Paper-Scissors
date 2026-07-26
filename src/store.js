// 基于 localStorage 的截图存储
const KEYS = {
  rock: 'rps_snapshot_rock',
  paper: 'rps_snapshot_paper',
  scissors: 'rps_snapshot_scissors'
}

export const GESTURES = ['rock', 'paper', 'scissors']

export function getSnapshot(gesture) {
  return localStorage.getItem(KEYS[gesture]) || null
}

export function saveSnapshot(gesture, dataUrl) {
  localStorage.setItem(KEYS[gesture], dataUrl)
}

export function clearSnapshots() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k))
}

export function hasTrained() {
  return GESTURES.every((g) => !!getSnapshot(g))
}
