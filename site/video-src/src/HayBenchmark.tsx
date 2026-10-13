import {Series} from "remotion";
import {fps, scenes} from "./scenes";

export function HayBenchmark() {
  return <Series>
    {scenes.map(scene => <Series.Sequence key={scene.id} name={scene.name}
      durationInFrames={scene.frames} premountFor={fps}><scene.component/></Series.Sequence>)}
  </Series>;
}
