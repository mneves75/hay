import {colors, data, FilmFrame, mono} from "./FilmFrame";

export function FeaturesScene() {
  return <FilmFrame footer="Live files. Explicit Git repository scopes. No persistent index or search history.">
    <h1 style={{fontSize: 84, lineHeight: 1.1, fontWeight: 650, letterSpacing: "-.025em", margin: "0 0 38px"}}>Find the file. Give your agent a session.</h1>
    <div style={{borderTop: `1px solid ${colors["strong-rule"]}`, paddingTop: 24, marginBottom: 34}}>
      <h2 style={{fontSize: 54, margin: "0 0 12px"}}>Live filename discovery</h2>
      <div style={{fontSize: 32, color: colors.green, marginBottom: 18}}>Available in source {data.sourceVersion}</div>
      <div style={{fontFamily: mono, fontSize: 48, marginBottom: 12}}>hay --find sesison .</div>
      <div style={{fontSize: 36, color: colors.muted}}>Exact names, substrings and an adjacent typo.</div>
    </div>
    <div style={{borderTop: `1px solid ${colors.rule}`, paddingTop: 24}}>
      <h2 style={{fontSize: 54, margin: "0 0 12px"}}>Manually started stdio MCP</h2>
      <div style={{fontSize: 32, color: colors.green, marginBottom: 18}}>Available in source {data.sourceVersion}</div>
      <div style={{fontFamily: mono, fontSize: 48, marginBottom: 12}}>hay --mcp --root .</div>
      <div style={{fontSize: 36, color: colors.muted}}>grep · find_files · multi_grep</div>
    </div>
  </FilmFrame>;
}
