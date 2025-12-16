import { useEffect, useMemo, useRef, useState } from "react";
import * as Cesium from "cesium";
import { io, Socket } from "socket.io-client";
import { accessToken } from "../config/cesiumConfig";

Cesium.Ion.defaultAccessToken = accessToken;


type Detector = {
  detector_id: number;
  lat: number;
  lng: number;
};

type Road = {
  road_id: number;
  name: string;
  detector: Detector;
};

type Site = {
  lat: number;
  lng: number;
  name: string;
  roads: Road[];
};

type Props = {
  site: Site;
};

type VehicleState = {
  id: string;
  position: Cesium.SampledPositionProperty;
};


function enuToWorld(
  lat: number,
  lng: number,
  x: number,
  y: number,
  z = 20
) {
  const origin = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);

  return Cesium.Matrix4.multiplyByPoint(
    enu,
    new Cesium.Cartesian3(x, y, z),
    new Cesium.Cartesian3()
  );
}


export default function CesiumMap({ site }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  const vehiclesRef = useRef<Map<string, VehicleState>>(new Map());


  const detectorMap = useMemo(() => {
    const map = new Map<number, { lat: number; lng: number }>();
    site.roads.forEach((r) =>
      map.set(r.road_id, {
        lat: r.detector.lat,
        lng: r.detector.lng,
      })
    );
    return map;
  }, [site]);


  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain:Cesium.Terrain.fromWorldTerrain(),
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      homeButton: false,
      geocoder: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });

    viewerRef.current = viewer;


    const start = Cesium.JulianDate.now();
    viewer.clock.startTime = start.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.stopTime = Cesium.JulianDate.addSeconds(
      start,
      3600,
      new Cesium.JulianDate()
    );
    viewer.clock.shouldAnimate = true;

    // Initial camera
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        site.lng,
        site.lat,
        500
      ),
      orientation: {
        pitch: Cesium.Math.toRadians(-45),
      },
    });

    // OSM Buildings
    Cesium.Cesium3DTileset.fromIonAssetId(96188).then((tileset) => {
      viewer.scene.primitives.add(tileset);
    });

    // Detector points
    site.roads.forEach((road) => {
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          road.detector.lng,
          road.detector.lat
        ),
        point: {
          pixelSize: 10,
          color: Cesium.Color.RED,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        label: {
          text: road.name,
          pixelOffset: new Cesium.Cartesian2(0, -15),
          scale: 0.5,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      });
    });

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [site]);


  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || detectorMap.size === 0) return;

    const socket: Socket = io("ws://192.168.20.200:7172", {
      path: "/socket.io",
      transports: ["websocket"],
    });

    socket.on("new_radar_data", (raw: string) => {
      let msg: any;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      const radar = detectorMap.get(Number(msg.road_id));
      if (!radar) return;

      msg.data.forEach((obj: any) => {
        const id = `${msg.road_id}-${obj.object_id}`;
        let vehicle = vehiclesRef.current.get(id);

        if (!vehicle) {
          const position = new Cesium.SampledPositionProperty();
          position.setInterpolationOptions({
            interpolationAlgorithm: Cesium.LinearApproximation,
            interpolationDegree: 1,
          });

          viewer.entities.add({
            id,
            position,
            orientation: new Cesium.VelocityOrientationProperty(position),
            point: {
              pixelSize: 8,
              color: Cesium.Color.BLUE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });

          vehicle = { id, position };
          vehiclesRef.current.set(id, vehicle);
        }

        vehicle.position.addSample(
          Cesium.JulianDate.now(),
          enuToWorld(
            radar.lat,
            radar.lng,
            obj.xpos,
            obj.ypos,
            20
          )
        );
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [detectorMap]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100vh" }}
    />
  );
}
