import {OpeningScene} from "./OpeningScene";
import {OrderScene} from "./OrderScene";
import {FeaturesScene} from "./FeaturesScene";
import {EvidenceScene} from "./EvidenceScene";
import {InstallScene} from "./InstallScene";

export const fps = 30;
export const scenes = [
  {id: "Opening", name: "Promise", frames: 4 * fps, component: OpeningScene},
  {id: "Order", name: "Same matches, better order", frames: 12 * fps, component: OrderScene},
  {id: "Features", name: "Source-only features", frames: 7 * fps, component: FeaturesScene},
  {id: "Evidence", name: "Dated evidence and limits", frames: 8 * fps, component: EvidenceScene},
  {id: "Install", name: "Installation choices", frames: 5 * fps, component: InstallScene},
] as const;
export const durationInFrames = scenes.reduce((total, scene) => total + scene.frames, 0);
