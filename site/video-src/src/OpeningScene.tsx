import {Easing, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {colors, FilmFrame} from "./FilmFrame";

export function OpeningScene() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return <FilmFrame footer="Complete searches preserve the normalized ripgrep match set. Caps or read errors mean incomplete.">
    <div style={{height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
      translate: `0 ${interpolate(frame, [0, .8 * fps], [24, 0], {extrapolateLeft: "clamp",
        extrapolateRight: "clamp", easing: Easing.bezier(.16, 1, .3, 1)})}px`}}>
      <div style={{fontSize: 156, fontWeight: 750, lineHeight: 1.04, letterSpacing: "-.035em"}}>Same matches.</div>
      <div style={{fontSize: 156, fontWeight: 750, lineHeight: 1.04, letterSpacing: "-.035em", color: colors.green}}>Better order.</div>
      <p style={{fontSize: 48, lineHeight: 1.4, maxWidth: 1300, marginTop: 44}}>A ranked grep for coding agents.<br/>Likely definitions first. Then one result from each file.</p>
    </div>
  </FilmFrame>;
}
