import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import { accessToken } from "../config/cesiumConfig";

Cesium.Ion.defaultAccessToken = accessToken;

type Site = {
  lat: number;
  lng: number;
  name: string;
  roads: {
    name: string;
    detector: {
      lat: number;
      lng: number;
    };
  }[];
};

type Props = {
  site?: Site; 
};

export default function CesiumMap({ site }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const siteRenderedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const initViewer = async () => {
      const viewer = new Cesium.Viewer(containerRef.current!, {
        terrainProvider: await Cesium.createWorldTerrainAsync(),
        animation: false,
        timeline: false,
      });

      viewerRef.current = viewer;
    };

    initViewer();

    return () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, []);



  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100vh" }}
    />
  );
}
