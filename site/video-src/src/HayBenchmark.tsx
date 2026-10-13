import {Series, useVideoConfig} from "remotion";
import {OpeningScene} from "./OpeningScene";
import {OrderScene} from "./OrderScene";
import {FeaturesScene} from "./FeaturesScene";
import {EvidenceScene} from "./EvidenceScene";
import {InstallScene} from "./InstallScene";

export function HayBenchmark() {
  const {fps} = useVideoConfig();
  return <Series>
    <Series.Sequence name="Promise" durationInFrames={4 * fps} premountFor={fps}><OpeningScene/></Series.Sequence>
    <Series.Sequence name="Same matches, better order" durationInFrames={12 * fps} premountFor={fps}><OrderScene/></Series.Sequence>
    <Series.Sequence name="Source-only features" durationInFrames={7 * fps} premountFor={fps}><FeaturesScene/></Series.Sequence>
    <Series.Sequence name="Dated evidence and limits" durationInFrames={8 * fps} premountFor={fps}><EvidenceScene/></Series.Sequence>
    <Series.Sequence name="Installation choices" durationInFrames={5 * fps} premountFor={fps}><InstallScene/></Series.Sequence>
  </Series>;
}
