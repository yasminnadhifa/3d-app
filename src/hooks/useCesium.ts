// useCesium.ts
import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import { accessToken } from "../config/cesiumConfig";

Cesium.Ion.defaultAccessToken = accessToken;

export function useCesium() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);

  useEffect(() => {
    const initCesium = async () => {
      if (!containerRef. current || viewerRef.current) return;

      // Init Cesium viewer
      const v = new Cesium.Viewer(containerRef.current, {
        terrainProvider: await Cesium. createWorldTerrainAsync(),
      });

      viewerRef.current = v;
      setViewer(v);
    };

    initCesium();

    return () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, []);

  return { containerRef, viewer };
}
