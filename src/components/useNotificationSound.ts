import { useEffect, useRef } from 'react'
import dingUrl from '../assets/Iphone SMS (Ting).mp3'

type Options = {
  volume?: number
  cooldownMs?: number
  enabled?: boolean
}

export function useNotificationSound(options?: Options) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastPlayRef = useRef<number>(0)
  const enabledRef = useRef<boolean>(options?.enabled ?? true)
  const primedRef = useRef<boolean>(false)
  const cooldown = options?.cooldownMs ?? 2000
  const volume = options?.volume ?? 0.8

  useEffect(() => {
    const a = new Audio(dingUrl)
    a.volume = volume
    audioRef.current = a
    return () => {
      try { audioRef.current?.pause() } catch {}
      audioRef.current = null
    }
  }, [volume])

  function play() {
    if (!enabledRef.current) return
    if (document.visibilityState !== 'visible') return
    const now = Date.now()
    if (now - lastPlayRef.current < cooldown) return
    lastPlayRef.current = now
    const a = audioRef.current
    if (a) {
      try {
        a.currentTime = 0
        void a.play()
      } catch {
        // silently ignore if playback is blocked by browser policy
      }
    }
  }

  // Prime playback once on a user gesture: play muted to satisfy autoplay policies
  function prime() {
    const a = audioRef.current
    if (!a || primedRef.current) return
    try {
      a.muted = true
      a.currentTime = 0
      const p = a.play()
      if (p && typeof p.then === 'function') {
        p.then(() => {
          a.pause()
          a.muted = false
          primedRef.current = true
        }).catch(() => { /* ignore */ })
      } else {
        a.pause()
        a.muted = false
        primedRef.current = true
      }
    } catch {
      // ignore
    }
  }

  function setEnabled(v: boolean) { enabledRef.current = v }

  return { play, setEnabled, prime }
}