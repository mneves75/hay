import type {PropsWithChildren, ReactNode} from "react";
import {loadFont} from "@remotion/fonts";
import {AbsoluteFill, cancelRender, staticFile} from "remotion";
import film from "../public/film-data.json";

void loadFont({family: "Archivo", url: staticFile("archivo-latin.woff2"),
  weight: "400 900", format: "woff2"}).catch(cancelRender);

export const data = film;
export const colors = film.colors;
export const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
export function FilmFrame({children, footer}: PropsWithChildren<{footer: ReactNode}>) {
  return <AbsoluteFill style={{backgroundColor: colors.paper, color: colors.ink,
    fontFamily: "Archivo, sans-serif", fontSynthesis: "none", padding: 100,
    display: "flex", flexDirection: "column", gap: 24}}>
    <div style={{fontSize: 48, fontWeight: 900, lineHeight: 1, color: colors.green}}>hay</div>
    <div style={{flex: 1, minHeight: 0, position: "relative"}}>{children}</div>
    <div style={{borderTop: `1px solid ${colors["strong-rule"]}`, paddingTop: 18,
      color: colors.muted, fontSize: 28, lineHeight: 1.4}}>{footer}</div>
  </AbsoluteFill>;
}
