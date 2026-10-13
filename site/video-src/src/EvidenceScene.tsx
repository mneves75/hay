import {colors, data, FilmFrame} from "./FilmFrame";

export function EvidenceScene() {
  return <FilmFrame footer="The private behavioral gate still fails. It was not rerun for these source-only features.">
    <h1 style={{fontSize: 84, lineHeight: 1.1, fontWeight: 650, letterSpacing: "-.025em", margin: "0 0 18px"}}>Evidence. Including the limits.</h1>
    <p style={{fontSize: 32, margin: "0 0 24px", color: colors.muted}}>Historical definition-finding benchmark · {data.evidence.version} · {data.evidence.date}</p>
    <table style={{borderCollapse: "collapse", width: "100%", fontVariantNumeric: "tabular-nums", textAlign: "left"}}>
      <thead><tr>{["Corpus / queries", "hay MRR", "rg path order", "Difference / 95% interval"].map(label => <th key={label} style={{fontSize: 30, fontWeight: 550, padding: "12px 18px", borderBottom: `1px solid ${colors["strong-rule"]}`}}>{label}</th>)}</tr></thead>
      <tbody>{data.evidence.rows.map(row => <tr key={row.label}>
        <th style={{fontSize: 38, fontWeight: 500, padding: "20px 18px", borderBottom: `1px solid ${colors.rule}`}}>{row.label}<span style={{fontSize: 25, color: colors.muted, marginLeft: 18}}>n={row.queries}</span></th>
        <td style={{fontSize: 44, color: colors.green, padding: "20px 18px", borderBottom: `1px solid ${colors.rule}`}}>{row.hay.toFixed(3)}</td>
        <td style={{fontSize: 44, padding: "20px 18px", borderBottom: `1px solid ${colors.rule}`}}>{row.rg.toFixed(3)}</td>
        <td style={{fontSize: 36, padding: "14px 18px", borderBottom: `1px solid ${colors.rule}`}}>{row.delta >= 0 ? "+" : ""}{row.delta.toFixed(3)}<div style={{fontSize: 26, color: colors.muted}}>[{row.lo.toFixed(3)}, {row.hi.toFixed(3)}]</div></td>
      </tr>)}</tbody>
    </table>
    <p style={{fontSize: 32, color: colors.muted, marginTop: 26}}>Definition finding is hay’s home turf, not agent-task success.</p>
    <p style={{fontSize: 30, color: colors.muted, marginTop: 12}}>Documentation track: {data.evidence.docs.wins} detected wins; {data.evidence.docs.regressions} detected regressions.</p>
  </FilmFrame>;
}
