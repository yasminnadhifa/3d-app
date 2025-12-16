import { useMemo, useEffect, useState, useRef } from "react";
import { Viewer, Entity, Cesium3DTileset, CameraFlyTo } from "resium";
import * as Cesium from "cesium";
import { io, Socket } from "socket.io-client";
import { accessToken } from "../config/cesiumConfig";

Cesium.Ion.defaultAccessToken = accessToken;

// OSM Buildings
const osmBuildingsUrl = Cesium.IonResource.fromAssetId(96188);

const carUrl = Cesium.IonResource.fromAssetId(4224101)

type Detector = {
  detector_id: number;
  lat: number;
  lng: number;
  direction_deg: number;
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
  site_id: number;
};

type Props = {
  site: Site;
};

type VehicleState = {
  id: string;
  position: Cesium.Cartesian3;
};

function radarRelativeToWorld(
  radarLat: number,
  radarLng: number,
  xpos: number, // forward dari radar (meter)
  ypos: number, // right dari radar (meter)
  directionDeg: number, // heading radar dari north (0=north, 90=east, clockwise)
  z = 0
): Cesium.Cartesian3 {
  // Posisi radar
  const radarPosition = Cesium.Cartesian3.fromDegrees(radarLng, radarLat, 0);
  
  // Transform matrix ENU -> World
  const enuToWorld = Cesium.Transforms.eastNorthUpToFixedFrame(radarPosition);
  
  // Heading dalam radians
  const heading = Cesium.Math.toRadians(directionDeg);
  
  // Konversi dari radar local (forward=x, right=y) ke ENU (east, north)
  const east = xpos * Math.sin(heading) + ypos * Math.cos(heading);
  const north = xpos * Math.cos(heading) - ypos * Math.sin(heading);
  
  // Apply transform
  const worldPosition = Cesium.Matrix4.multiplyByPoint(
    enuToWorld,
    new Cesium.Cartesian3(east, north, z),
    new Cesium.Cartesian3()
  );
  
  return worldPosition;
}

export default function CesiumMap({ site }: Props) {
  const [terrainProvider, setTerrainProvider] =
    useState<Cesium.TerrainProvider | null>(null);

  const [vehicles, setVehicles] = useState<Map<string, VehicleState>>(
    new Map()
  );

  const [cameraInitialized, setCameraInitialized] = useState(false);

  useEffect(() => {
    let mounted = true;

    Cesium.createWorldTerrainAsync().then((provider) => {
      if (mounted) setTerrainProvider(provider);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const detectorMap = useMemo(() => {
    const map = new Map<number, { lat: number; lng: number; direction_deg: number }>();
    site.roads.forEach((road) => {
      map.set(road.road_id, {
        lat: road.detector.lat,
        lng: road.detector.lng,
        direction_deg: road.detector.direction_deg,
      });
    });
    return map;
  }, [site]);

  useEffect(() => {
    if (!terrainProvider || detectorMap.size === 0) return;

    const socket: Socket = io("ws://192.168.20.200:7172", {
      path: "/socket.io",
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log("socket connected", socket.id);

      site.roads.forEach((road) => {
        const roomName = `site_${site.site_id}_road_${road.road_id}`;
        socket.emit("enter_room", roomName);
      });
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

      setVehicles((prev) => {
        const next = new Map(prev);

        msg.data.forEach((obj: any) => {
          const id = `${msg.road_id}-${obj.object_id}`;

          next.set(id, {
            id,
            position: radarRelativeToWorld(
              radar.lat,
              radar.lng,
              obj.xpos,
              obj.ypos,
              radar.direction_deg,
              0
            ),
          });
        });

        return next;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [terrainProvider, detectorMap, site]);

  if (!terrainProvider) return null;

  return (
    <Viewer
      full
      terrainProvider={terrainProvider}
      shouldAnimate
      timeline={false}
      fullscreenButton={false}
      baseLayerPicker={false}
      homeButton={false}
      navigationHelpButton={false}
      sceneModePicker={false}
      geocoder={false}
      infoBox={false}
      selectionIndicator={false}
      style={{ width: "100%", height: "100vh" }}
    >
      {!cameraInitialized && (
        <CameraFlyTo
          destination={Cesium.Cartesian3.fromDegrees(site.lng, site.lat, 500)}
          orientation={{
            pitch: Cesium.Math.toRadians(-45),
            heading: 0,
            roll: 0,
          }}
          duration={0}
          onComplete={() => setCameraInitialized(true)}
        />
      )}

      <Cesium3DTileset url={osmBuildingsUrl} />

      {site.roads.map((road) => (
        <Entity
          key={road.road_id}
          position={Cesium.Cartesian3.fromDegrees(
            road.detector.lng,
            road.detector.lat
          )}
          point={{
            pixelSize: 10,
            color: Cesium.Color.RED,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          }}
          label={{
            text: road.name,
            pixelOffset: new Cesium.Cartesian2(0, -15),
            scale: 0.5,
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          }}
        />
      ))}

      {Array.from(vehicles.values()).map((v) => (
        <Entity
          key={v.id}
          position={v.position}
          point={{
            pixelSize: 8,
            color: Cesium.Color.BLUE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND

          }}
        />
      ))}
    </Viewer>
  );
}
