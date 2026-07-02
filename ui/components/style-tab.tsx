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

/** CSS var per caption font — faces loaded in layout.tsx, same ones Remotion burns. */
const FONT_FAMILY: Record<string, string> = {
  anton: 'var(--cap-anton)', bangers: 'var(--cap-bangers)', archivo: 'var(--cap-archivo)',
  montserrat: 'var(--cap-montserrat)', poppins: 'var(--cap-poppins)', inter: 'var(--cap-inter)',
};

interface PresetStyle {
  font: string; fontSize: number; emphasisSize: number; baseColor: string; activeColor?: string;
  strokeWidth: number; strokeColor: string; position: 'bottom' | 'center'; uppercase: boolean;
  background: 'none' | 'card';
}

/** Mirror of src/captions/presets.ts CAPTION_PRESETS — keep in sync (display-only copy). */
const PRESET_STYLES: Record<string, PresetStyle> = {
  mrbeast: { font: 'bangers', fontSize: 78, emphasisSize: 94, baseColor: '#FFFFFF', activeColor: '#FFE81A', strokeWidth: 10, strokeColor: '#000000', position: 'bottom', uppercase: true, background: 'none' },
  hormozi: { font: 'montserrat', fontSize: 70, emphasisSize: 84, baseColor: '#FFFFFF', activeColor: '#00FF47', strokeWidth: 8, strokeColor: '#000000', position: 'bottom', uppercase: true, background: 'card' },
  gadzhi: { font: 'montserrat', fontSize: 60, emphasisSize: 72, baseColor: '#F5F0E8', activeColor: '#D9B36A', strokeWidth: 0, strokeColor: '#000000', position: 'bottom', uppercase: false, background: 'none' },
  gaming: { font: 'bangers', fontSize: 74, emphasisSize: 90, baseColor: '#FFFFFF', activeColor: '#00E5FF', strokeWidth: 8, strokeColor: '#000000', position: 'bottom', uppercase: true, background: 'none' },
  podcast: { font: 'inter', fontSize: 54, emphasisSize: 62, baseColor: '#FFFFFF', strokeWidth: 3, strokeColor: '#000000', position: 'bottom', uppercase: false, background: 'none' },
  cinematic: { font: 'montserrat', fontSize: 46, emphasisSize: 52, baseColor: '#EDEDED', strokeWidth: 0, strokeColor: '#000000', position: 'center', uppercase: true, background: 'none' },
  bold: { font: 'anton', fontSize: 70, emphasisSize: 84, baseColor: '#FFFFFF', strokeWidth: 0, strokeColor: '#000000', position: 'bottom', uppercase: true, background: 'none' },
  minimal: { font: 'inter', fontSize: 56, emphasisSize: 64, baseColor: '#FFFFFF', strokeWidth: 2, strokeColor: '#000000', position: 'bottom', uppercase: false, background: 'none' },
  card: { font: 'anton', fontSize: 70, emphasisSize: 84, baseColor: '#FFFFFF', strokeWidth: 0, strokeColor: '#000000', position: 'bottom', uppercase: true, background: 'card' },
};

/** Resolve preset + overrides exactly like the renderer (resolveCaptionStyle mirror). */
function resolvePreview(cfg: StyleConfig): PresetStyle {
  const base = PRESET_STYLES[cfg.preset] ?? PRESET_STYLES.bold;
  const out = { ...base };
  if (cfg.font && FONT_FAMILY[cfg.font]) out.font = cfg.font;
  if (cfg.fontSize > 0) {
    out.emphasisSize = Math.round(cfg.fontSize * (base.emphasisSize / base.fontSize));
    out.fontSize = cfg.fontSize;
  }
  if (cfg.captionColor) out.baseColor = cfg.captionColor;
  if (cfg.stroke >= 0) out.strokeWidth = cfg.stroke;
  if (cfg.position === 'bottom' || cfg.position === 'center') out.position = cfg.position;
  return out;
}

const PREVIEW_SCALE = 0.25; // 270x480 box previews the 1080x1920 render

/** Live 9:16 caption preview — sample line with the middle word active, at true relative scale.
 *  Plays the newest exported clip's RAW footage behind the captions when one exists
 *  (the final has captions burned in already); falls back to a mock frame. */
function CaptionPreview({ cfg, videoSrc }: { cfg: StyleConfig; videoSrc?: string | null }) {
  const s = resolvePreview(cfg);
  const words = ['this', 'got', 'insane'];
  const activeIdx = 1;
  const active = s.activeColor ?? cfg.accent;

  const wordSpan = (w: string, i: number) => {
    const isActive = i === activeIdx;
    const size = (isActive ? s.emphasisSize : s.fontSize) * PREVIEW_SCALE;
    return (
      <span
        key={i}
        style={{
          fontFamily: FONT_FAMILY[s.font],
          fontSize: size,
          color: isActive ? active : s.baseColor,
          WebkitTextStroke: s.strokeWidth > 0 ? `${Math.max(0.5, s.strokeWidth * PREVIEW_SCALE)}px ${s.strokeColor}` : undefined,
          paintOrder: 'stroke fill',
          marginRight: 8,
          display: 'inline-block',
          transform: isActive ? 'scale(1.06)' : undefined,
        }}
      >
        {s.uppercase ? w.toUpperCase() : w}
      </span>
    );
  };

  return (
    <div className="relative h-[480px] w-[270px] shrink-0 overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-zinc-700 via-ink-900 to-black">
      {videoSrc ? (
        <video
          src={videoSrc} autoPlay muted loop playsInline
          className="absolute inset-0 h-full w-full object-contain bg-black"
        />
      ) : (
        <>
          {/* no exports yet — fake subject so the frame reads as video */}
          <div className="absolute left-1/2 top-[30%] h-24 w-24 -translate-x-1/2 rounded-full bg-zinc-600/50" />
          <div className="absolute left-1/2 top-[42%] h-40 w-36 -translate-x-1/2 rounded-t-[3rem] bg-zinc-600/40" />
        </>
      )}
      <div
        className="absolute left-0 right-0 px-3 text-center leading-tight"
        style={s.position === 'center' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: '18%' }}
      >
        <span style={s.background === 'card' ? { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '2px 10px', boxDecorationBreak: 'clone' } : undefined}>
          {words.map(wordSpan)}
        </span>
      </div>
      <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">live preview</span>
    </div>
  );
}

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

export function StyleTab({ style, onChange, previewSrc }: {
  style: StyleConfig; onChange: (s: StyleConfig) => void;
  /** URL of a raw exported clip to play behind the caption preview (null → mock frame). */
  previewSrc?: string | null;
}) {
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
        <p className="mb-4 text-sm text-zinc-500">Each control defaults to the preset&apos;s value — override only what you want to change. The preview updates live with the exact fonts the render burns in.</p>
        <div className="flex flex-col gap-6 lg:flex-row">
        <CaptionPreview cfg={style} videoSrc={previewSrc} />
        <div className="grid max-w-3xl flex-1 grid-cols-2 gap-4 sm:grid-cols-4 content-start">
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
