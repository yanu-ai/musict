import { Check, Minus, Plus, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import type { Capabilities } from '../audio/player'
import type { Stem } from '../lib/types'
import { Fader } from './Fader'
import { Knob } from './Knob'
import { Toggle } from './Toggle'

type StemMixerProps = {
  capabilities: Capabilities
  /** False until the separation backend exists. */
  backendReady: boolean
  stems: Stem[]
  onStemChange: (id: string, patch: Partial<Stem>) => void
  stemsOn: boolean
  onStemsOnChange: (v: boolean) => void
  speed: number
  onSpeedChange: (v: number) => void
  pitch: number
  onPitchChange: (v: number) => void
  cents: number
  onCentsChange: (v: number) => void
  preservePitch: boolean
  onPreservePitchChange: (v: boolean) => void
}

const SPEED_PRESETS = [0.5, 0.75, 1]

/** Accepts "65", "65%" or "0.65". */
function parseSpeed(text: string): number | null {
  const n = parseFloat(text)
  if (!Number.isFinite(n)) return null
  return n > 2 || text.includes('%') ? n / 100 : n
}

function parsePitch(text: string): number | null {
  const n = parseInt(text, 10)
  return Number.isFinite(n) ? n : null
}

export function StemMixer(props: StemMixerProps) {
  const { stems, stemsOn, capabilities: caps } = props
  const [picking, setPicking] = useState(false)
  const shown = stems.filter((s) => s.shown)
  const anySolo = shown.some((s) => s.solo)
  const pickable = stems.filter((s) => s.id !== 'rest')
  const stemsUsable = caps.stems && props.backendReady
  const speedStep = Math.max(0.05, caps.speedStep)
  const snapSpeed = (v: number) => Math.round(v / caps.speedStep) * caps.speedStep

  return (
    <aside className="neu-raised flex h-full flex-col overflow-y-auto rounded-[32px] p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Stems</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Choose stems"
            aria-expanded={picking}
            title="Choose stems"
            onClick={() => setPicking((v) => !v)}
            className={`flex size-8 items-center justify-center rounded-full transition-colors ${
              picking ? 'neu-inset text-accent' : 'neu-soft text-muted hover:text-ink'
            }`}
          >
            <SlidersHorizontal className="size-3.5" />
          </button>
          <Toggle label="Use separated stems" checked={stemsOn} onChange={props.onStemsOnChange} disabled={!stemsUsable} />
        </div>
      </div>

      {!stemsUsable && (
        <p className="mb-5 rounded-2xl border border-dashed border-line px-3 py-2.5 text-xs text-muted">
          {caps.stems
            ? 'Stem separation isn’t connected yet. It arrives with the backend.'
            : 'Stems need an uploaded file. YouTube doesn’t share a video’s audio.'}
        </p>
      )}

      {picking && (
        <div className="neu-inset mb-5 rounded-2xl p-3">
          <p className="mb-2.5 text-xs text-muted">Pull out these instruments. Everything else stays in Rest.</p>
          <div className="flex flex-wrap gap-1.5">
            {pickable.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.shown}
                onClick={() => props.onStemChange(s.id, s.shown ? { shown: false, solo: false } : { shown: true })}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors ${
                  s.shown ? 'neu-soft text-accent' : 'text-faint ring-1 ring-line hover:text-muted'
                }`}
              >
                {s.shown && <Check className="size-3" />}
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className={`grid gap-1 transition-opacity ${stemsOn && stemsUsable ? '' : 'pointer-events-none opacity-40'}`}
        style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
      >
        {shown.map((s) => {
          const audible = !s.muted && (!anySolo || s.solo)
          return (
            <div key={s.id} className="flex min-w-0 flex-col items-center gap-3">
              <Fader label={s.name} value={s.level} dimmed={!audible} onChange={(level) => props.onStemChange(s.id, { level })} />
              <span
                className="w-full truncate text-center text-[11px] font-semibold text-muted"
                title={s.id === 'rest' ? 'Everything not separated above' : s.name}
              >
                {s.name}
              </span>
              <div className={`flex gap-0.5 ${shown.length > 5 ? 'flex-col' : ''}`}>
                <StemButton label="M" title={`Mute ${s.name}`} on={s.muted} onClick={() => props.onStemChange(s.id, { muted: !s.muted })} />
                <StemButton label="S" title={`Solo ${s.name}`} on={s.solo} onClick={() => props.onStemChange(s.id, { solo: !s.solo })} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="my-5 h-px bg-line" />

      <div className="grid grid-cols-2 gap-2">
        <Knob
          label="Speed"
          value={props.speed}
          min={0.25}
          max={1.5}
          step={speedStep}
          format={(v) => `${Math.round(v * 100)}%`}
          parse={(t) => {
            const v = parseSpeed(t)
            return v === null ? null : snapSpeed(v)
          }}
          onChange={props.onSpeedChange}
        >
          <div className="mt-2 flex gap-1">
            {SPEED_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={props.speed === v}
                onClick={() => props.onSpeedChange(v)}
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  props.speed === v ? 'neu-inset text-accent' : 'neu-soft text-faint hover:text-muted'
                }`}
              >
                {v * 100}
              </button>
            ))}
          </div>
        </Knob>
        <Knob
          label="Pitch"
          value={props.pitch}
          min={-12}
          max={12}
          step={1}
          bipolar
          disabled={!caps.pitch}
          format={(v) => (v > 0 ? `+${v} st` : `${v} st`)}
          parse={parsePitch}
          onChange={props.onPitchChange}
        >
          <div className="mt-2 flex items-center gap-1" title="Fine tune, for recordings that aren't at A440">
            <button
              type="button"
              aria-label="Fine tune down 5 cents"
              onClick={() => props.onCentsChange(Math.max(-50, props.cents - 5))}
              className="neu-soft flex size-5 items-center justify-center rounded-full text-faint hover:text-muted"
            >
              <Minus className="size-3" />
            </button>
            <button
              type="button"
              title="Reset fine tune"
              onClick={() => props.onCentsChange(0)}
              className={`w-11 font-mono text-[10px] ${props.cents ? 'text-accent' : 'text-faint'}`}
            >
              {props.cents > 0 ? '+' : ''}
              {props.cents}¢
            </button>
            <button
              type="button"
              aria-label="Fine tune up 5 cents"
              onClick={() => props.onCentsChange(Math.min(50, props.cents + 5))}
              className="neu-soft flex size-5 items-center justify-center rounded-full text-faint hover:text-muted"
            >
              <Plus className="size-3" />
            </button>
          </div>
        </Knob>
      </div>

      <div className="mt-auto flex items-center justify-between pt-6">
        <span className={`text-sm ${caps.pitch ? 'text-muted' : 'text-faint'}`}>Preserve pitch when slowing</span>
        <Toggle label="Preserve pitch" checked={props.preservePitch} onChange={props.onPreservePitchChange} disabled={!caps.pitch} />
      </div>
    </aside>
  )
}

function StemButton({ label, title, on, onClick }: { label: string; title: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`size-5 rounded-md font-mono text-[10px] font-medium transition-colors ${
        on ? 'neu-inset text-accent' : 'neu-soft text-faint hover:text-muted'
      }`}
    >
      {label}
    </button>
  )
}
