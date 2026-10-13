import { Composition, Folder } from "remotion";
import { HayBenchmark } from "./HayBenchmark";
import {durationInFrames, fps, scenes} from "./scenes";

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="HayBenchmark"
      component={HayBenchmark}
      durationInFrames={durationInFrames}
      fps={fps}
      width={1920}
      height={1080}
    />
    <Folder name="Scenes">
      {scenes.map(scene => <Composition key={scene.id} id={scene.id} component={scene.component}
        durationInFrames={scene.frames} fps={fps} width={1920} height={1080}/>)}
    </Folder>
    </>
  );
};
