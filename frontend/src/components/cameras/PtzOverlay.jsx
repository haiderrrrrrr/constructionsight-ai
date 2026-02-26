import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiPost, apiGet } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const RING_R        = 46
const KNOB_R        = 17
const DEAD_ZONE     = 0.08
const MIN_SPEED     = 0.35
const HEARTBEAT_MS  = 2000
const STOP_DELAY_MS = 380

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ── PTZ icon ──────────────────────────────────────────────────────────────────
const CrosshairIcon = ({ size = 13, color = 'currentColor', style }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        fill="none"
        style={{ flexShrink: 0, display: 'block', ...(style || {}) }}
    >
        <circle cx="7" cy="7" r="2.5" stroke={color} strokeWidth="1.4" />
        <line x1="7"    y1="0.5"  x2="7"    y2="3.5"  stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        <line x1="7"    y1="10.5" x2="7"    y2="13.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        <line x1="0.5"  y1="7"   x2="3.5"  y2="7"    stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        <line x1="10.5" y1="7"   x2="13.5" y2="7"    stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
)

// ── Shared PTZ state machine ──────────────────────────────────────────────────
//
// One source of truth: state = { pan, tilt, zoom }.
// One in-flight HTTP request at a time (cameras don't queue ContinuousMove).
// One cancellable stop timer — any new move cancels it, preventing the race
// where a delayed stop from zoom-release kills a subsequent joystick move.
//
// Public API:
//   movePanTilt(pan, tilt)  — joystick calls this; zoom value is preserved
//   moveZoom(z)             — zoom strip calls this; pan/tilt values are preserved
//   release('panTilt'|'zoom') — zero that axis; re-fire if other axis still active,
//                               else schedule stop after STOP_DELAY_MS
const usePtzCommands = (cameraId, onActivity) => {
    const state     = useRef({ pan: 0, tilt: 0, zoom: 0 })
    const moveCtrl  = useRef(null)
    const stopCtrl  = useRef(null)
    const stopTimer = useRef(null)
    const lastToast = useRef(0)

    const cancelStop = useCallback(() => {
        if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null }
    }, [])

    // Clean up on unmount — abort any in-flight requests and pending timers
    useEffect(() => () => {
        cancelStop()
        if (moveCtrl.current) moveCtrl.current.abort()
        if (stopCtrl.current) stopCtrl.current.abort()
    }, [cancelStop])

    // Send one merged ContinuousMove; cancels any pending stop and stale move.
    const fire = useCallback((pan, tilt, zoom) => {
        state.current = { pan, tilt, zoom }
        cancelStop()

        if (stopCtrl.current) stopCtrl.current.abort()
        if (moveCtrl.current) moveCtrl.current.abort()
        const ctrl = new AbortController()
        moveCtrl.current = ctrl

        const p = pan  === 0 ? 0 : Math.sign(pan)  * Math.max(MIN_SPEED, Math.abs(pan))
        const t = tilt === 0 ? 0 : Math.sign(tilt) * Math.max(MIN_SPEED, Math.abs(tilt))
        const z = zoom === 0 ? 0 : Math.sign(zoom) * Math.max(MIN_SPEED, Math.abs(zoom))

        onActivity?.()
        apiPost(
            `/admin/cameras/${cameraId}/ptz/move`,
            { pan: p, tilt: t, zoom: z, speed: 1.0 },
            { signal: ctrl.signal, timeoutMs: 3000 },
        ).catch((err) => {
            if (err?.name === 'AbortError' || err?.name === 'CanceledError') return
            const now = Date.now()
            if (now - lastToast.current > 2500) {
                lastToast.current = now
                topTostError('PTZ move failed — check ONVIF connection.')
            }
        })
    }, [cameraId, onActivity, cancelStop])

    // Joystick move — always merges current zoom value into the command.
    const movePanTilt = useCallback((pan, tilt) => {
        fire(pan, tilt, state.current.zoom)
    }, [fire])

    // Zoom move — always merges current pan/tilt values into the command.
    const moveZoom = useCallback((z) => {
        fire(state.current.pan, state.current.tilt, z)
    }, [fire])

    // Called when joystick or zoom button is released.
    // Zeros that axis; if other axis still active → re-fire; else → schedule stop.
    const release = useCallback((axis) => {
        if (axis === 'panTilt') { state.current.pan = 0; state.current.tilt = 0 }
        if (axis === 'zoom')    { state.current.zoom = 0 }

        const { pan, tilt, zoom } = state.current
        if (pan !== 0 || tilt !== 0 || zoom !== 0) {
            fire(pan, tilt, zoom)
            return
        }

        // Everything released — schedule stop
        cancelStop()
        stopTimer.current = setTimeout(() => {
            stopTimer.current = null
            if (stopCtrl.current) stopCtrl.current.abort()
            const ctrl = new AbortController()
            stopCtrl.current = ctrl
            apiPost(`/admin/cameras/${cameraId}/ptz/stop`, {}, { signal: ctrl.signal, timeoutMs: 3000 })
                .catch((err) => {
                    if (err?.name === 'AbortError' || err?.name === 'CanceledError') return
                })
        }, STOP_DELAY_MS)
    }, [cameraId, fire, cancelStop])

    return { movePanTilt, moveZoom, release }
}

// ── Joystick ──────────────────────────────────────────────────────────────────
const Joystick = ({ onMove, onRelease, onDragChange, tone }) => {
    const ringRef = useRef(null)
    const knobRef = useRef(null)
    const s = useRef({ dragging: false, pan: 0, tilt: 0, beatId: null })

    const calcDir = (e) => {
        if (!ringRef.current) return null
        const r   = ringRef.current.getBoundingClientRect()
        const dx  = e.clientX - (r.left + r.width  / 2)
        const dy  = e.clientY - (r.top  + r.height / 2)
        const max = RING_R - KNOB_R
        const sc  = Math.min(Math.sqrt(dx * dx + dy * dy) / max, 1)
        const ang = Math.atan2(dy, dx)
        return {
            knobX: Math.cos(ang) * sc * max,
            knobY: Math.sin(ang) * sc * max,
            pan:   clamp(dx / max, -1, 1),
            tilt:  clamp(-dy / max, -1, 1),
        }
    }

    const dz = (v) => (Math.abs(v) < DEAD_ZONE ? 0 : v)

    const beat = useCallback(() => {
        if (s.current.beatId) clearInterval(s.current.beatId)
        s.current.beatId = setInterval(() => {
            if (!s.current.dragging) { clearInterval(s.current.beatId); s.current.beatId = null; return }
            onMove(s.current.pan, s.current.tilt)
        }, HEARTBEAT_MS)
    }, [onMove])

    const killBeat = () => {
        if (s.current.beatId) { clearInterval(s.current.beatId); s.current.beatId = null }
    }

    const release = useCallback(() => {
        if (!s.current.dragging) return
        s.current.dragging = false; s.current.pan = 0; s.current.tilt = 0
        killBeat()
        if (knobRef.current) knobRef.current.style.transform = 'translate(-50%,-50%)'
        onDragChange?.(false)
        onRelease('panTilt')
    }, [onRelease, onDragChange])

    useEffect(() => {
        document.addEventListener('pointerup',     release)
        document.addEventListener('pointercancel', release)
        window.addEventListener('blur', release)
        const onVis = () => { if (document.hidden) release() }
        document.addEventListener('visibilitychange', onVis)
        return () => {
            document.removeEventListener('pointerup',     release)
            document.removeEventListener('pointercancel', release)
            window.removeEventListener('blur', release)
            document.removeEventListener('visibilitychange', onVis)
            killBeat()
        }
    }, [release])

    const handleDown = useCallback((e) => {
        e.preventDefault()
        ringRef.current?.setPointerCapture(e.pointerId)
        const d = calcDir(e); if (!d) return
        // Always mark dragging so handleMove works even if press starts in dead zone
        s.current.dragging = true; s.current.pan = 0; s.current.tilt = 0
        onDragChange?.(true)
        const pan = dz(d.pan), tilt = dz(d.tilt)
        if (pan !== 0 || tilt !== 0) {
            s.current.pan = pan; s.current.tilt = tilt
            onMove(pan, tilt)
            beat()
        }
    }, [onMove, beat, onDragChange])

    const handleMove = useCallback((e) => {
        if (!s.current.dragging || !knobRef.current) return
        e.preventDefault()
        const d = calcDir(e); if (!d) return
        knobRef.current.style.transform =
            `translate(calc(-50% + ${d.knobX}px), calc(-50% + ${d.knobY}px))`
        const pan = dz(d.pan), tilt = dz(d.tilt)
        if (Math.abs(pan - s.current.pan) > 0.10 || Math.abs(tilt - s.current.tilt) > 0.10) {
            s.current.pan = pan; s.current.tilt = tilt
            if (pan === 0 && tilt === 0) {
                // Entered dead zone — stop camera but keep drag session alive so
                // moving back out resumes without requiring a new press.
                killBeat()
                onRelease('panTilt')
                return
            }
            onMove(pan, tilt); beat()
        }
    }, [onMove, beat, onRelease])

    return (
        <div ref={ringRef} onPointerDown={handleDown} onPointerMove={handleMove}
            style={{
                width: RING_R * 2, height: RING_R * 2, borderRadius: '50%',
                background: tone?.ringBg,
                border: `1.5px solid ${tone?.ringBorder}`,
                boxShadow: tone?.ringShadow,
                position: 'relative', flexShrink: 0,
                cursor: 'grab', touchAction: 'none', userSelect: 'none',
            }}
        >
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', left: '50%', top: 8, bottom: 8, width: 1, background: tone?.hairline, transform: 'translateX(-50%)' }} />
                <div style={{ position: 'absolute', top: '50%', left: 8, right: 8, height: 1, background: tone?.hairline, transform: 'translateY(-50%)' }} />
            </div>
            {[
                { s: { top: 6,    left: '50%', transform: 'translateX(-50%)' }, pts: '0,7 4,0 8,7' },
                { s: { bottom: 6, left: '50%', transform: 'translateX(-50%)' }, pts: '0,0 4,7 8,0' },
                { s: { left: 6,   top: '50%',  transform: 'translateY(-50%)' }, pts: '7,0 0,4 7,8' },
                { s: { right: 6,  top: '50%',  transform: 'translateY(-50%)' }, pts: '0,0 7,4 0,8' },
            ].map((a, i) => (
                <svg key={i} width={8} height={8} viewBox="0 0 8 8"
                    style={{ position: 'absolute', opacity: 0.28, pointerEvents: 'none', ...a.s }}>
                    <polyline points={a.pts} fill="none" stroke={tone?.iconStroke} strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            ))}
            <div ref={knobRef} style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%,-50%)',
                width: KNOB_R * 2, height: KNOB_R * 2, borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 30%, rgba(82,114,235,0.95), rgba(52,84,209,0.98))',
                boxShadow: tone?.knobShadow,
                pointerEvents: 'none',
                transition: 'transform 0.05s ease',
            }} />
        </div>
    )
}

// ── Zoom strip ────────────────────────────────────────────────────────────────
const ZoomStrip = ({ onZoom, onRelease, tone }) => {
    const held = useRef({ dir: 0, beatId: null })

    const stopBeat = useCallback(() => {
        if (held.current.beatId) { clearInterval(held.current.beatId); held.current.beatId = null }
    }, [])

    const release = useCallback(() => {
        if (held.current.dir === 0) return
        held.current.dir = 0
        stopBeat()
        onRelease('zoom')
    }, [onRelease, stopBeat])

    useEffect(() => {
        window.addEventListener('blur', release)
        document.addEventListener('pointerup',     release)
        document.addEventListener('pointercancel', release)
        const onVis = () => { if (document.hidden) release() }
        document.addEventListener('visibilitychange', onVis)
        return () => {
            window.removeEventListener('blur', release)
            document.removeEventListener('pointerup',     release)
            document.removeEventListener('pointercancel', release)
            document.removeEventListener('visibilitychange', onVis)
            stopBeat()
        }
    }, [release, stopBeat])

    const press = (dir) => (e) => {
        e.preventDefault()
        held.current.dir = dir
        const z = dir * 0.7
        onZoom(z)
        stopBeat()
        held.current.beatId = setInterval(() => {
            if (held.current.dir !== 0) onZoom(z)
        }, HEARTBEAT_MS)
    }

    const btnStyle = {
        width: 30, height: 30,
        border: `1px solid ${tone?.btnBorder}`, borderRadius: 7,
        background: tone?.btnBg, color: tone?.text,
        fontSize: 17, fontWeight: 300, lineHeight: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        touchAction: 'none', userSelect: 'none', flexShrink: 0,
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.09em', color: tone?.muted, textTransform: 'uppercase', marginBottom: 1 }}>ZOOM</span>
            <button style={btnStyle}
                onPointerDown={press(1)} onPointerUp={release}
                onPointerLeave={release} onPointerCancel={release}>+</button>
            <div style={{ width: 1, height: 10, background: tone?.hairline }} />
            <button style={btnStyle}
                onPointerDown={press(-1)} onPointerUp={release}
                onPointerLeave={release} onPointerCancel={release}>−</button>
        </div>
    )
}

// ── Main overlay ──────────────────────────────────────────────────────────────
const PtzOverlay = ({ cameraId }) => {
    const [presets,      setPresets]      = useState([])
    const [activePreset, setActivePreset] = useState(null)
    const [visible,      setVisible]      = useState(false)
    const [active,       setActive]       = useState(false)
    const getIsDark = useCallback(() => {
        try {
            const html = document.documentElement
            const body = document.body
            const clsDark =
                html.classList.contains('app-skin-dark') ||
                body.classList.contains('app-skin-dark')
            const dataTheme =
                (html.getAttribute('data-bs-theme') || html.getAttribute('data-theme') || '').toLowerCase()
            return clsDark || dataTheme === 'dark'
        } catch {
            return false
        }
    }, [])

    const [isDark, setIsDark] = useState(() => getIsDark())
    const actTimer = useRef(null)

    useEffect(() => {
        const update = () => setIsDark(getIsDark())
        update()
        const obs = new MutationObserver(update)
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-bs-theme', 'data-theme'] })
        if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [getIsDark])

    const onActivity = useCallback(() => {
        setActive(true)
        if (actTimer.current) clearTimeout(actTimer.current)
        actTimer.current = setTimeout(() => setActive(false), 600)
    }, [])

    const t = useCallback((lightVal, darkVal) => (isDark ? darkVal : lightVal), [isDark])

    const tone = useMemo(() => ({
        text:      t('rgba(2,6,23,0.86)',  'rgba(255,255,255,0.86)'),
        muted:     t('rgba(2,6,23,0.42)',  'rgba(255,255,255,0.40)'),
        hairline:  t('rgba(2,6,23,0.12)',  'rgba(255,255,255,0.10)'),
        iconStroke:t('rgba(2,6,23,0.55)',  'rgba(255,255,255,0.55)'),

        ringBg:    t('rgba(2,6,23,0.04)',  'rgba(255,255,255,0.06)'),
        ringBorder:t('rgba(2,6,23,0.10)',  'rgba(255,255,255,0.14)'),
        ringShadow:t('inset 0 1px 4px rgba(0,0,0,0.08)', 'inset 0 1px 4px rgba(0,0,0,0.45)'),
        knobShadow:t('0 3px 10px rgba(0,0,0,0.18), 0 0 0 1.5px rgba(82,114,235,0.35)', '0 3px 10px rgba(0,0,0,0.55), 0 0 0 1.5px rgba(82,114,235,0.40)'),

        btnBg:     t('rgba(2,6,23,0.04)',  'rgba(255,255,255,0.07)'),
        btnBorder: t('rgba(2,6,23,0.12)',  'rgba(255,255,255,0.16)'),

        panelBg:   t('rgba(255,255,255,0.92)', 'rgba(8,8,20,0.86)'),
        panelBorder:t('rgba(2,6,23,0.10)', 'rgba(255,255,255,0.10)'),
        accent:    t('rgba(var(--bs-primary-rgb), 0.28)', 'rgba(82,114,235,0.34)'),
        shadow:    t('0 10px 32px rgba(0,0,0,0.18)', '0 10px 40px rgba(0,0,0,0.60)'),
    }), [t])

    const { movePanTilt, moveZoom, release } = usePtzCommands(cameraId, onActivity)

    useEffect(() => {
        apiGet(`/admin/cameras/${cameraId}/ptz/presets`, { timeoutMs: 5000 })
            .then(setPresets)
            .catch(() => {})
        return () => { if (actTimer.current) clearTimeout(actTimer.current) }
    }, [cameraId])

    const gotoPreset = async (token) => {
        setActivePreset(token)
        try {
            await apiPost(`/admin/cameras/${cameraId}/ptz/presets/goto`,
                { preset_token: token }, { timeoutMs: 7000 })
        } catch {
            topTostError('Failed to go to preset')
        } finally {
            setActivePreset(null)
        }
    }

    if (!visible) return (
        <button onClick={() => setVisible(true)} style={{
            position: 'absolute', bottom: 12, right: 12, zIndex: 10,
            background: t('rgba(var(--bs-body-bg-rgb), 0.75)', 'rgba(8,8,18,0.75)'),
            border: t('1px solid rgba(2,6,23,0.10)', '1px solid rgba(255,255,255,0.10)'),
            borderRadius: 8,
            color: t('rgba(var(--bs-body-color-rgb), 0.72)', 'rgba(255,255,255,0.72)'),
            padding: '5px 11px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            cursor: 'pointer', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', gap: 5,
        }}>
            <CrosshairIcon
                size={11}
                color={t('rgba(var(--bs-primary-rgb), 0.85)', 'rgba(82,114,235,0.90)')}
                style={{ transform: 'translateY(-1px)' }}
            /> PTZ
        </button>
    )

    return (
        <div style={{
            position: 'absolute', bottom: 14, right: 14, zIndex: 10,
            background: tone.panelBg,
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: `1px solid ${tone.panelBorder}`,
            borderRadius: 13,
            padding: '10px 13px 13px',
            display: 'flex', flexDirection: 'column', gap: 10,
            minWidth: 148,
            boxShadow: tone.shadow,
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <CrosshairIcon
                        size={13}
                        color={active
                            ? t('rgba(var(--bs-primary-rgb), 1)', 'rgba(82,114,235,1)')
                            : t('rgba(var(--bs-primary-rgb), 0.78)', 'rgba(82,114,235,0.82)')
                        }
                        style={{ transform: 'translateY(-1px)' }}
                    />
                    <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.11em',
                        color: active
                            ? t('rgba(var(--bs-body-color-rgb), 0.92)', 'rgba(255,255,255,0.90)')
                            : t('rgba(var(--bs-body-color-rgb), 0.62)', 'rgba(255,255,255,0.62)'),
                        textTransform: 'uppercase', lineHeight: 1,
                    }}>PTZ</span>
                    <div style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: active
                            ? t('rgba(var(--bs-primary-rgb), 1)', 'rgba(82,114,235,1)')
                            : t('rgba(var(--bs-body-color-rgb), 0.16)', 'rgba(255,255,255,0.16)'),
                        marginLeft: 2,
                    }} />
                </div>
                <button
                    type="button"
                    className="btn-close"
                    onClick={() => setVisible(false)}
                    style={{
                        width: 12,
                        height: 12,
                        padding: 0,
                        borderRadius: 8,
                        transform: 'translate(2px, -1px)',
                        opacity: isDark ? 0.55 : 0.45,
                        filter: isDark ? 'invert(1) grayscale(100%)' : 'none',
                        backgroundSize: '12px 12px',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat',
                        transition: 'none',
                        boxShadow: 'none',
                    }}
                />
            </div>

            {/* Joystick + Zoom */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Joystick
                    onMove={movePanTilt}
                    onRelease={release}
                    onDragChange={dragging => dragging && onActivity()}
                    tone={tone}
                />
                <ZoomStrip
                    onZoom={(z) => { moveZoom(z); onActivity() }}
                    onRelease={release}
                    tone={tone}
                />
            </div>

            {/* Presets */}
            {presets.length > 0 && (
                <div>
                    <div style={{
                        fontSize: 8, fontWeight: 700, letterSpacing: '0.09em',
                        color: tone.muted,
                        textTransform: 'uppercase', marginBottom: 5,
                    }}>Presets</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {presets.slice(0, 6).map((p) => (
                            <button key={p.token} onClick={() => gotoPreset(p.token)}
                                disabled={!!activePreset} title={p.name}
                                style={{
                                    padding: '3px 9px', fontSize: 10, fontWeight: 600, borderRadius: 5,
                                    border: `1px solid ${tone.btnBorder}`,
                                    background: activePreset === p.token
                                        ? t('rgba(var(--bs-primary-rgb), 0.25)', 'rgba(82,114,235,0.35)')
                                        : tone.btnBg,
                                    color: tone.text,
                                    cursor: activePreset ? 'wait' : 'pointer',
                                    whiteSpace: 'nowrap', maxWidth: 74, overflow: 'hidden',
                                    textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4,
                                }}>
                                {activePreset === p.token &&
                                    <span className="spinner-border" style={{ width: 7, height: 7, borderWidth: 1, flexShrink: 0 }} />}
                                {p.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

export default PtzOverlay
