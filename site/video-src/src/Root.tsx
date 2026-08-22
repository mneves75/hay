import { Composition } from "remotion";
import { HayBenchmark } from "./HayBenchmark";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="HayBenchmark"
      component={HayBenchmark}
      durationInFrames={18 * 30}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
