import {Easing, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {colors, data, FilmFrame, mono} from "./FilmFrame";

export function OrderScene() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const ranked = frame >= 4.5 * fps;
  const moving = frame >= 3 * fps && !ranked;
  return <FilmFrame footer={ranked
    ? "hay order: declaration first; four different files before a file’s second result."
    : moving ? "Only the reading order changes. All six matching lines stay in the result."
      : "Path order: the declaration is fourth. Six complete matches across four synthetic files."}>
    <h1 style={{fontSize: 64, fontWeight: 650, letterSpacing: "-.025em", margin: "0 0 14px", lineHeight: 1.15}}>One query. A better reading order.</h1>
    <div style={{fontFamily: mono, fontSize: 32, color: colors.green, marginBottom: 26}}>hay validateSession . <span style={{fontFamily: "Archivo", color: colors.muted, marginLeft: 40}}>Illustrative fixture · {data.hay.length} matches · {data.fileCount} files</span></div>
    <div style={{position: "relative", height: 576, borderTop: `1px solid ${colors["strong-rule"]}`}}>
      {data.rg.map((row, original) => {
        const target = data.hay.findIndex(other => other.path === row.path && other.number === row.number);
        const definition = row.text.startsWith("export function validateSession");
        return <div key={`${row.path}:${row.number}`} style={{position: "absolute", left: 0, right: 0,
          height: 96, display: "grid", gridTemplateColumns: "44px 440px 1fr", alignItems: "center", gap: 24,
          top: interpolate(frame, [3 * fps, 4.5 * fps], [original * 96, target * 96], {
            extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(.16, 1, .3, 1)}),
          backgroundColor: colors.paper, color: definition ? colors.green : colors.ink,
          borderBottom: `1px solid ${definition ? colors.green : colors.rule}`, zIndex: definition ? 2 : 1}}>
          <span style={{fontSize: 30, fontVariantNumeric: "tabular-nums", color: colors.muted}}>{(ranked ? target : original) + 1}</span>
          <span style={{fontFamily: mono, fontSize: 23, lineHeight: 1.4, overflowWrap: "anywhere"}}>{row.path}:{row.number}</span>
          <span style={{fontFamily: mono, fontSize: 26, lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontWeight: definition ? 650 : 400}}>{row.text}</span>
        </div>;
      })}
    </div>
  </FilmFrame>;
}
