import benchmarkPayload from "../../../evidence/benchmark.json";
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

type ToolScore = { tool: string; available: boolean; mrr: number };
type CorpusReport = { corpus: string; queries: number; tools: ToolScore[] };
type BenchmarkPayload = { corpora: CorpusReport[] };
type CorpusDatum = { name: string; hay: number; rg: number };

const MIN_USABLE_QUERIES = 10;
const corpusNames: Record<string, string> = {
  linux: "linux kernel",
  openclaw: "openclaw",
  ripgrep: "ripgrep source",
  alamofire: "alamofire",
};

const findTool = (corpus: CorpusReport, tool: string): ToolScore => {
  const score = corpus.tools.find((candidate) => candidate.tool === tool && candidate.available);
  if (!score) throw new Error("benchmark evidence missing available " + tool + " score for " + corpus.corpus);
  if (!Number.isFinite(score.mrr) || score.mrr < 0 || score.mrr > 1) {
    throw new Error("benchmark evidence has invalid " + tool + " MRR for " + corpus.corpus);
  }
  return score;
};

const deriveCorpora = (payload: BenchmarkPayload): CorpusDatum[] => {
  const corpora = payload.corpora.filter((corpus) => corpus.queries >= MIN_USABLE_QUERIES);
  if (corpora.length !== 4) {
    throw new Error("video layout requires exactly four usable benchmark corpora; found " + corpora.length);
  }
  for (const corpus of corpora) {
    const hay = findTool(corpus, "hay");
    const competitors = corpus.tools.filter((tool) => tool.tool !== "hay" && tool.available);
    if (competitors.length === 0) {
      throw new Error("benchmark evidence has no available comparator for " + corpus.corpus);
    }
    const strongestOther = Math.max(...competitors.map((tool) => {
      if (!Number.isFinite(tool.mrr) || tool.mrr < 0 || tool.mrr > 1)
        throw new Error("benchmark evidence has invalid " + tool.tool + " MRR for " + corpus.corpus);
      return tool.mrr;
    }));
    if (hay.mrr <= strongestOther) {
      throw new Error("benchmark copy unsupported: hay is not first on " + corpus.corpus);
    }
  }
  return corpora.map((corpus) => ({
    name: corpusNames[corpus.corpus] ?? corpus.corpus,
    hay: findTool(corpus, "hay").mrr,
    rg: findTool(corpus, "rg").mrr,
  }));
};

const CORPORA = deriveCorpora(benchmarkPayload as BenchmarkPayload);
const usableCorpusPhrase = CORPORA.length === 4 ? "four usable corpora" : String(CORPORA.length) + " usable corpora";

const C = {
  ground: "#f8f5ec",
  panel: "#fffdf6",
  ink: "#201b10",
  soft: "#5c5544",
  faint: "#8b8371",
  rule: "#e7e1cf",
  accent: "#8a6d10",
  accentSoft: "#f1e7c8",
  mutedBar: "#cdb87a",
};

const serif = 'Georgia, "Times New Roman", serif';
const mono = '"SFMono-Regular", Menlo, Consolas, monospace';

const RuledBg: React.FC = () => (
  <AbsoluteFill
    style={{
      position: "absolute",
      inset: 0,
      background: C.ground,
      backgroundImage: `repeating-linear-gradient(${C.rule}55 0 2px, transparent 2px 34px)`,
    }}
  />
);

const TitleScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame: f, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <RuledBg />
      <div style={{ textAlign: "center", translate: `0 ${interpolate(rise, [0, 1], [40, 0])}px`, opacity: rise }}>
        <div style={{ fontFamily: mono, fontSize: 26, letterSpacing: "0.24em", textTransform: "uppercase", color: C.accent, marginBottom: 28 }}>
          hay · ranked grep
        </div>
        <div style={{ fontFamily: mono, fontSize: 190, fontWeight: 700, color: C.accent, letterSpacing: "-0.04em", lineHeight: 1 }}>hay</div>
        <div style={{ fontFamily: serif, fontSize: 62, color: C.ink, marginTop: 24 }}>A ranked grep for coding agents</div>
        <div style={{ fontFamily: mono, fontSize: 32, color: C.soft, marginTop: 20 }}>
          on complete searches, hay returns ripgrep&rsquo;s matches — reordered
        </div>
      </div>
    </AbsoluteFill>
  );
};

const BarRow: React.FC<{ name: string; hay: number; rg: number; delay: number; f: number; fps: number; wMax: number }> = ({
  name, hay, rg, delay, f, fps, wMax,
}) => {
  const grow = spring({ frame: f - delay, fps, config: { damping: 200 }, durationInFrames: 45 });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 36, marginBottom: 44 }}>
      <div style={{ width: 330, textAlign: "right", fontFamily: mono, fontSize: 36, color: C.ink }}>{name}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 12 }}>
          <div style={{ width: wMax * rg, height: 26, background: C.mutedBar, borderRadius: 4, opacity: 0.75 }} />
          <span style={{ fontFamily: mono, fontSize: 28, color: C.faint }}>{rg.toFixed(3)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: wMax * hay * grow, height: 44, background: C.accent, borderRadius: 4 }} />
          <span style={{ fontFamily: mono, fontSize: 40, fontWeight: 700, color: C.accent }}>{(hay * grow).toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
};

const BenchmarkScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const wMax = 900;
  return (
    <AbsoluteFill style={{ background: C.ground, padding: "90px 110px" }}>
      <RuledBg />
      <div style={{ position: "relative" }}>
        <div style={{ fontFamily: mono, fontSize: 26, letterSpacing: "0.24em", textTransform: "uppercase", color: C.accent }}>
          public benchmark · {usableCorpusPhrase} · parser ground truth
        </div>
        <div style={{ fontFamily: serif, fontSize: 72, color: C.ink, margin: "18px 0 60px", fontWeight: 600 }}>
          First on every usable corpus.
        </div>
        {CORPORA.map((c, i) => (
          <BarRow key={c.name} name={c.name} hay={c.hay} rg={c.rg} delay={i * 18} f={f} fps={fps} wMax={wMax} />
        ))}
        <div
          style={{
            fontFamily: mono,
            fontSize: 30,
            color: C.soft,
            marginTop: 8,
            opacity: interpolate(f, [110, 130], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          bars = mean reciprocal rank · muted = plain ripgrep · gold = hay · full intervals at the live page
        </div>
      </div>
    </AbsoluteFill>
  );
};

const GuaranteeScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 8, fps, config: { damping: 12, stiffness: 90 } });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <RuledBg />
      <div style={{ textAlign: "center", position: "relative" }}>
        <div style={{ fontFamily: mono, fontSize: 120, color: C.accent, scale: Math.max(pop, 0), display: "inline-block" }}>
          differential: 0 differing
        </div>
        <div style={{ fontFamily: serif, fontSize: 76, color: C.ink, marginTop: 40 }}>Complete searches match ripgrep exactly.</div>
        <div style={{ fontFamily: serif, fontSize: 76, color: C.ink, opacity: interpolate(f, [30, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          Only the order changes.
        </div>
        <div
          style={{
            marginTop: 54,
            display: "inline-block",
            fontFamily: mono,
            fontSize: 34,
            color: C.soft,
            border: `1px solid ${C.rule}`,
            borderRadius: 8,
            padding: "18px 34px",
            background: C.ground,
            opacity: interpolate(f, [60, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          exit 0 found · 1 nothing · 2 incomplete — never silent
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EndScene: React.FC = () => {
  const f = useCurrentFrame();
  const installCommand = "cargo install --locked --path hay";
  const chars = Math.floor(interpolate(f, [10, 55], [0, installCommand.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const cmd = installCommand.slice(0, chars);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <RuledBg />
      <div style={{ textAlign: "center", position: "relative" }}>
        <div style={{ fontFamily: mono, fontSize: 46, color: C.accent, letterSpacing: "0.2em" }}>HAY</div>
        <div
          style={{
            marginTop: 40,
            display: "inline-block",
            fontFamily: mono,
            fontSize: 64,
            color: C.ink,
            background: C.panel,
            border: `1px solid ${C.rule}`,
            borderRadius: 10,
            padding: "28px 52px",
          }}
        >
          <span style={{ color: C.faint }}>$ </span>
          {cmd}
          <span style={{ color: C.accent, opacity: f % 30 < 15 ? 1 : 0 }}>▌</span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 30, color: C.soft, marginTop: 48 }}>github.com/mneves75/hay</div>
      </div>
    </AbsoluteFill>
  );
};

export const HayBenchmark: React.FC = () => (
  <AbsoluteFill>
    <Sequence durationInFrames={90}>
      <TitleScene />
    </Sequence>
    <Sequence from={90} durationInFrames={210}>
      <BenchmarkScene />
    </Sequence>
    <Sequence from={300} durationInFrames={120}>
      <GuaranteeScene />
    </Sequence>
    <Sequence from={420} durationInFrames={120}>
      <EndScene />
    </Sequence>
  </AbsoluteFill>
);
