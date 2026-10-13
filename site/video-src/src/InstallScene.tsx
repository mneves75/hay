import {colors, data, FilmFrame, mono} from "./FilmFrame";

export function InstallScene() {
  return <FilmFrame footer="mneves75.github.io/hay/ · Read the methods and the complete installation instructions.">
    <h1 style={{fontSize: 132, lineHeight: 1.06, fontWeight: 750, letterSpacing: "-.035em", margin: "30px 0 38px"}}>Get hay.<br/><span style={{color: colors.green}}>Read the evidence.</span></h1>
    <div style={{fontSize: 38, color: colors.muted, marginBottom: 20}}>Homebrew · supported binary {data.supportedBinary}</div>
    <div style={{fontFamily: mono, fontSize: 52, borderBlock: `1px solid ${colors["strong-rule"]}`, paddingBlock: 24}}>brew install mneves75/tap/hay</div>
    <p style={{fontSize: 38, marginTop: 32}}>Filename discovery and MCP require source {data.sourceVersion}.</p>
    <p style={{fontSize: 32, color: colors.muted, marginTop: 14}}>Use the pinned --locked source instructions on the page.</p>
  </FilmFrame>;
}
