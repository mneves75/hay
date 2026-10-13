import { Composition, Folder } from "remotion";
import { HayBenchmark } from "./HayBenchmark";
import {OpeningScene} from "./OpeningScene";
import {OrderScene} from "./OrderScene";
import {FeaturesScene} from "./FeaturesScene";
import {EvidenceScene} from "./EvidenceScene";
import {InstallScene} from "./InstallScene";

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="HayBenchmark"
      component={HayBenchmark}
      durationInFrames={36 * 30}
      fps={30}
      width={1920}
      height={1080}
    />
    <Folder name="Scenes">
      <Composition id="Opening" component={OpeningScene} durationInFrames={4 * 30} fps={30} width={1920} height={1080}/>
      <Composition id="Order" component={OrderScene} durationInFrames={12 * 30} fps={30} width={1920} height={1080}/>
      <Composition id="Features" component={FeaturesScene} durationInFrames={7 * 30} fps={30} width={1920} height={1080}/>
      <Composition id="Evidence" component={EvidenceScene} durationInFrames={8 * 30} fps={30} width={1920} height={1080}/>
      <Composition id="Install" component={InstallScene} durationInFrames={5 * 30} fps={30} width={1920} height={1080}/>
    </Folder>
    </>
  );
};
