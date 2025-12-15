import { useMemo, useEffect, useState, useRef } from "react";
import { Viewer, Entity, Cesium3DTileset, CameraFlyTo } from "resium";
import * as Cesium from "cesium";
import { accessToken } from "../config/cesiumConfig";
import { io, Socket } from "socket.io-client";

Cesium.Ion.defaultAccessToken = accessToken;
const osmBuildingsUrl = Cesium.IonResource.fromAssetId(96188);

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
function enuToWorld(
  radarLat: number,
  radarLng: number,
  x: number,
  y: number,
  z = 1
) {
  const radarPosition = Cesium.Cartesian3.fromDegrees(radarLng, radarLat, 0);

  const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(radarPosition);

  return Cesium.Matrix4.multiplyByPoint(
    enuTransform,
    new Cesium.Cartesian3(x, y, z),
    new Cesium.Cartesian3()
  );
}
type VehicleState = {
  id: string;
  position: Cesium.SampledPositionProperty;
};

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
  const map = new Map<number, { lat: number; lng: number }>();

  site.roads.forEach((road) => {
    map.set(road.road_id, {
      lat: road.detector.lat,
      lng: road.detector.lng,
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
    console.log("✅ socket connected", socket.id);
  });

  socket.on("new_radar_data", (raw: string) => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error("Invalid radar payload", raw);
      return;
    }

    const radar = detectorMap.get(Number(msg.road_id));
    if (!radar) return;

    setVehicles((prev) => {
      const next = new Map(prev);

      msg.data.forEach((obj) => {
        const vehicleId = `${msg.road_id}-${obj.object_id}`;

        let vehicle = next.get(vehicleId);
        if (!vehicle) {
          const position = new Cesium.SampledPositionProperty();
          position.setInterpolationOptions({
            interpolationDegree: 1,
            interpolationAlgorithm: Cesium.LinearApproximation,
          });

          vehicle = {
            id: vehicleId,
            position,
          };
          next.set(vehicleId, vehicle);
        }

        vehicle.position.addSample(
          Cesium.JulianDate.now(),
          enuToWorld(
            radar.lat,
            radar.lng,
            obj.xpos,
            obj.ypos,
            5
          )
        );
      });

      return next;
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ socket disconnected");
  });

  return () => {
    socket.disconnect();
  };
}, [terrainProvider, detectorMap]);



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
      {/* Camera */}

{!cameraInitialized && (
  <CameraFlyTo
    destination={Cesium.Cartesian3.fromDegrees(site.lng, site.lat, 500)}
    orientation={{
      pitch: Cesium.Math.toRadians(-45),
      heading: 0,
      roll: 0,
    }}
    duration={0}
    onComplete={() => {
      setCameraInitialized(true);
    }}
  />
)}


      <Cesium3DTileset url={osmBuildingsUrl} />

      {site.roads.map((road, index) => (
        <Entity
          key={`detector-${index}`}
          position={Cesium.Cartesian3.fromDegrees(
            road.detector.lng,
            road.detector.lat
          )}
          point={{
            pixelSize: 10,
            color: Cesium.Color.RED,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          }}
          label={{
            text: road.name,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            pixelOffset: new Cesium.Cartesian2(0, -15),
            scale: 0.5,
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          }}
        />
      ))}
      {Array.from(vehicles.values()).map((v) => (
        <Entity
          key={v.id}
          position={v.position}
          orientation={new Cesium.VelocityOrientationProperty(v.position)}
          point={{
            pixelSize: 8,
            color: Cesium.Color.BLUE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          }}
        />
      ))}
    </Viewer>
  );
}
