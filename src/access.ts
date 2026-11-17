import { useSyncExternalStore } from "react"

// 访问口令只存在这个标签页的 sessionStorage 里，关掉页面就没有了；不进仓库、不进构建产物。
const KEY = "expression-workbench.access-code"
const listeners = new Set<() => void>()

export function getAccessCode(): string {
  try {
    return window.sessionStorage.getItem(KEY)?.trim() ?? ""
  } catch {
    return ""
  }
}

export function setAccessCode(code: string) {
  try {
    if (code) window.sessionStorage.setItem(KEY, code)
    else window.sessionStorage.removeItem(KEY)
  } catch {
    // 隐私模式下可能写不进去；只影响下次不用重输
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAccessCode(): string {
  return useSyncExternalStore(subscribe, getAccessCode, () => "")
}
