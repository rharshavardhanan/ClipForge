'use client';

import { Card, Field, Stepper, inputCls } from './ui';

export interface StyleConfig {
  preset: string;
  accent: string;
  music: boolean;
  zooms: boolean;
  /** Caption overrides — empty string / 0 / -1 mean "use the preset's value". */
  font: string;
  fontSize: number;
  position: string;
  stroke: number;
  captionColor: string;
}

export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  preset: 'bold', accent: '#FFD700', music: true, zooms: true,
  font: '', fontSize: 0, position: '', stroke: -1, captionColor: '',
};

const FONTS = ['anton', 'bangers', 'archivo', 'montserrat', 'poppins', 'inter'] as const;

export const PRESETS = ['mrbeast', 'hormozi', 'gadzhi', 'gaming', 'podcast', 'cinematic', 'minimal', 'card', 'bold'] as const;

/** Representative CSS per preset for the live gallery mock (mirrors src/captions/presets.ts). */
const PRESET_CSS: Record<string, React.CSSProperties & { sample?: string }> = {
  mrbeast: { fontFamily: 'Impact, sans-serif', fontSize: 26, color: '#FFE81A', WebkitTextStroke: '1.5px black', textTransform: 'uppercase', sample: 'WAIT FOR IT' },
  hormozi: { fontFamily: 'Montserrat, Arial Black, sans-serif', fontWeight: 800, fontSize: 24, color: '#00FF47', textTransform: 'uppercase', backgroundColor: 'rgba(0,0,0,.6)', padding: '2px 10px', borderRadius: 8, sample: 'THIS IS THE SECRET' },
  gadzhi: { fontFamily: 'Montserrat, sans-serif', fontWeight: 700, fontSize: 22, color: '#D9B36A', textShadow: '0 0 14px #D9B36A', sample: 'discipline equals freedom' },
  gaming: { fontFamily: 'Impact, sans-serif', fontSize: 25, color: '#00E5FF', WebkitTextStroke: '1.2px black', textTransform: 'uppercase', sample: 'NO WAY HE HIT THAT' },
  podcast: { fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, fontSize: 20, color: '#FFFFFF', sample: 'and that changed everything' },
  cinematic: { fontFamily: 'Montserrat, sans-serif', fontWeight: 700, fontSize: 17, color: '#EDEDED', letterSpacing: '0.2em', textTransform: 'uppercase', sample: 'THE TURNING POINT' },
  minimal: { fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, fontSize: 20, color: '#FFFFFF', sample: 'clean and simple' },
  card: { fontFamily: 'Impact, sans-serif', fontSize: 24, color: '#FFFFFF', textTransform: 'uppercase', backgroundColor: 'rgba(0,0,0,.6)', padding: '2px 10px', borderRadius: 8, sample: 'BOXED CAPTIONS' },
  bold: { fontFamily: 'Impact, sans-serif', fontSize: 24, color: '#FFFFFF', textTransform: 'uppercase', textShadow: '2px 2px 4px black', sample: 'THE CLASSIC LOOK' },
};

export function StyleTab({ style, onChange }: { style: StyleConfig; onChange: (s: StyleConfig) => void }) {
  const cliFlags = [
    `--style ${style.preset}`,
    style.accent !== '#FFD700' ? `--accent "${style.accent}"` : '',
    style.font ? `--font ${style.font}` : '',
    style.fontSize > 0 ? `--font-size ${style.fontSize}` : '',
    style.position ? `--position ${style.position}` : '',
    style.stroke >= 0 ? `--stroke ${style.stroke}` : '',
    style.captionColor ? `--caption-color "${style.captionColor}"` : '',
    !style.music ? '--no-music' : '',
    !style.zooms ? '--no-zooms' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="mb-1 text-lg font-bold">Subtitle style</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Pick a preset — it applies to runs started from the Import tab. The gallery is a CSS approximation; the render uses the real fonts.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => {
            const { sample, ...css } = PRESET_CSS[p];
            const active = style.preset === p;
            return (
              <button
                key={p}
                onClick={() => onChange({ ...style, preset: p })}
                className={`flex h-28 flex-col items-center justify-center gap-2 rounded-xl border bg-gradient-to-b from-ink-700 to-ink-900 transition-colors ${active ? 'border-gold' : 'border-line hover:border-zinc-600'}`}
              >
                <span style={css}>{sample}</span>
                <span className={`text-xs font-semibold uppercase tracking-widest ${active ? 'text-gold' : 'text-zinc-500'}`}>{p}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Caption fine-tuning</h2>
        <p className="mb-4 text-sm text-zinc-500">Each control defaults to the preset&apos;s value — override only what you want to change.</p>
        <div className="grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Font">
            <select className={inputCls} value={style.font} onChange={(e) => onChange({ ...style, font: e.target.value })}>
              <option value="">Preset font</option>
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Font size">
            <select className={inputCls} value={String(style.fontSize)} onChange={(e) => onChange({ ...style, fontSize: parseInt(e.target.value, 10) })}>
              <option value="0">Preset size</option>
              {[44, 52, 60, 70, 80, 92].map((s) => <option key={s} value={s}>{s}px</option>)}
            </select>
          </Field>
          <Field label="Position">
            <select className={inputCls} value={style.position} onChange={(e) => onChange({ ...style, position: e.target.value })}>
              <option value="">Preset position</option>
              <option value="bottom">Bottom</option>
              <option value="center">Center</option>
            </select>
          </Field>
          <Field label="Stroke width">
            <select className={inputCls} value={String(style.stroke)} onChange={(e) => onChange({ ...style, stroke: parseInt(e.target.value, 10) })}>
              <option value="-1">Preset stroke</option>
              {[0, 3, 6, 10, 14].map((s) => <option key={s} value={s}>{s}px</option>)}
            </select>
          </Field>
          <Field label="Caption color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={style.captionColor || '#FFFFFF'}
                onChange={(e) => onChange({ ...style, captionColor: e.target.value })}
                className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-ink-800"
              />
              {style.captionColor && (
                <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => onChange({ ...style, captionColor: '' })}>
                  reset
                </button>
              )}
            </div>
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-bold">Options</h2>
        <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Accent color">
            <input
              type="color"
              value={style.accent}
              onChange={(e) => onChange({ ...style, accent: e.target.value })}
              className="h-10 w-full cursor-pointer rounded-lg border border-line bg-ink-800"
            />
          </Field>
          <Field label="Background music">
            <select className={inputCls} value={style.music ? 'on' : 'off'} onChange={(e) => onChange({ ...style, music: e.target.value === 'on' })}>
              <option value="on">Auto (mood-matched)</option>
              <option value="off">Off</option>
            </select>
          </Field>
          <Field label="Punch zooms">
            <select className={inputCls} value={style.zooms ? 'on' : 'off'} onChange={(e) => onChange({ ...style, zooms: e.target.value === 'on' })}>
              <option value="on">On (sparing)</option>
              <option value="off">Off</option>
            </select>
          </Field>
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          Background music comes from the <span className="font-mono text-zinc-400">./music</span> folder in the project root, organized by mood:
          <span className="font-mono text-zinc-400"> music/intense/ funny/ motivational/ suspense/ emotional/ chill/</span> (or prefix files like
          <span className="font-mono text-zinc-400"> funny_kazoo.mp3</span>). Drop royalty-free tracks in and each clip picks one matching its sentiment,
          ducked under speech automatically. No matching track → no music.
        </p>
        <p className="mt-3 font-mono text-xs text-zinc-500">CLI equivalent: {cliFlags}</p>
      </Card>
    </div>
  );
}
