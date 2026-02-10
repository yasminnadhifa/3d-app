import { useMemo, useEffect, useState } from "react";
import { Viewer, Entity, Cesium3DTileset, CameraFlyTo } from "resium";
import * as Cesium from "cesium";
import { io, Socket } from "socket.io-client";
import { accessToken } from "../config/cesiumConfig";

/*
  Configure Cesium Ion access token.
  Required for terrain and asset streaming from Cesium services.
*/
Cesium.Ion.defaultAccessToken = accessToken;

/*
  Cesium OSM 3D buildings tileset.
  Provides realistic city/building visualization.
*/
const osmBuildingsUrl = Cesium.IonResource.fromAssetId(96188);

/*
  Optional implementation:
  These asset IDs allow loading vehicle/pedestrian models
  directly from Cesium Ion instead of local GLB files.

  Use this when assets are managed centrally in Cesium Ion.
*/
// const VEHICLE_MODEL_ASSET_ID = assetIds.car;
// const PED_MODEL_ASSET_ID = assetIds.ped;

/*
  Model heading correction offsets.
  Aligns radar orientation with 3D model orientation.
*/
const VEHICLE_HEADING_OFFSET = 180;
const PED_HEADING_OFFSET = -90;

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

/*
  Runtime object state tracked in Cesium scene.
*/
type VehicleState = {
  id: string;
  position: Cesium.Cartesian3;
  heading: number;
  type: number;
  lastUpdate: number;
};

/*
  Convert radar-local coordinates into WGS84 coordinates.

  Radar reports positions relative to detector orientation.
  This function rotates local coordinates and converts
  meter offsets into geographic latitude/longitude.
*/
function radarToWGS84(
  radarLat: number,
  radarLon: number,
  radarDirection: number,
  xpos: number,
  ypos: number
) {
  const R = 6371000;

  const dirRad = (radarDirection * Math.PI) / 180;

  const rotatedX = xpos * Math.cos(dirRad) - ypos * Math.sin(dirRad);
  const rotatedY = xpos * Math.sin(dirRad) + ypos * Math.cos(dirRad);

  const lat1 = (radarLat * Math.PI) / 180;

  const dLat = rotatedY / R;
  const dLon = rotatedX / (R * Math.cos(lat1));

  const objLat = lat1 + dLat;
  const objLon = (radarLon * Math.PI) / 180 + dLon;

  return {
    latitude: (objLat * 180) / Math.PI,
    longitude: (objLon * 180) / Math.PI,
  };
}

/*
  Main Cesium map component.

  Responsibilities:
  - Terrain initialization
  - Radar socket streaming
  - Coordinate conversion
  - Dynamic entity rendering
*/
export default function CesiumMap({ site }: Props) {
  const [terrainProvider, setTerrainProvider] =
    useState<Cesium.TerrainProvider | null>(null);

  /*
    Local GLB model usage.
    Models are loaded directly from project assets.
  */
  const [vehicleModelUrl] = useState("/models/car.glb");
  const [pedModelUrl] = useState("/models/ped.glb");

  /*
    Optional Cesium Ion model loading.

    This block demonstrates loading models from Cesium Ion
    instead of local files. Useful for centralized asset
    management or streaming large models.

    Currently disabled because local assets are used.
  */

  // const [vehicleModelUrl, setVehicleModelUrl] = useState<string | null>(null);
  // const [pedModelUrl, setPedModelUrl] = useState<string | null>(null);

  // Active radar objects tracked in scene.
  const [vehicles, setVehicles] = useState<Map<string, VehicleState>>(
    new Map()
  );

  // Prevent repeated camera initialization.
  const [cameraInitialized, setCameraInitialized] = useState(false);

  // Load Cesium terrain provider.
  useEffect(() => {
    let mounted = true;

    Cesium.createWorldTerrainAsync().then((provider) => {
      if (mounted) setTerrainProvider(provider);
    });

    /*
      Optional Cesium Ion model loading example
    */

    // Cesium.IonResource.fromAssetId(VEHICLE_MODEL_ASSET_ID).then((resource) => {
    //   if (mounted) setVehicleModelUrl(resource);
    // });

    // Cesium.IonResource.fromAssetId(PED_MODEL_ASSET_ID).then((resource) => {
    //   if (mounted) setPedModelUrl(resource);
    // });

    return () => {
      mounted = false;
    };
  }, []);

  /*
    Remove stale radar objects periodically.
    Prevents memory growth.
  */
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      setVehicles((prev) => {
        const next = new Map(prev);
        let changed = false;

        next.forEach((vehicle, id) => {
          if (now - vehicle.lastUpdate > 3000) {
            next.delete(id);
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Detector lookup map for coordinate conversion.
  const detectorMap = useMemo(() => {
    const map = new Map<
      number,
      { lat: number; lng: number; direction_deg: number }
    >();

    site.roads.forEach((road) => {
      map.set(road.road_id, {
        lat: road.detector.lat,
        lng: road.detector.lng,
        direction_deg: road.detector.direction_deg,
      });
    });

    return map;
  }, [site]);

  /*
    WebSocket connection for real-time radar streaming.
  */
  useEffect(() => {
    if (!terrainProvider || !vehicleModelUrl || !pedModelUrl || detectorMap.size === 0)
      return;

    const socket: Socket = io("ws://192.168.20.200:7172", {
      path: "/socket.io",
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      site.roads.forEach((road) => {
        const room = `site_${site.site_id}_road_${road.road_id}`;
        socket.emit("enter_room", room);
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

          const wgs84 = radarToWGS84(
            radar.lat,
            radar.lng,
            radar.direction_deg,
            obj.xpos,
            obj.ypos
          );

          const position = Cesium.Cartesian3.fromDegrees(
            wgs84.longitude,
            wgs84.latitude,
            0
          );

          const heading =
            (radar.direction_deg + (obj.heading || 0)) % 360;

          next.set(id, {
            id,
            position,
            heading,
            type: obj.object_type,
            lastUpdate: Date.now(),
          });
        });

        return next;
      });
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected");
    });

    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });

    return () => {
      socket.disconnect();
    };
  }, [terrainProvider, vehicleModelUrl, pedModelUrl, detectorMap, site]);

  if (!terrainProvider || !vehicleModelUrl || !pedModelUrl) return null;

  return (
    /*
      Main Cesium Viewer container.

      UI controls are disabled to create a clean visualization
      focused on radar tracking and 3D environment rendering.
    */
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

      {/*
        Initial camera positioning.

        Moves the camera to the site location once on load.
        Prevents repeated camera resets during re-renders.
      */}
      {!cameraInitialized && (
        <CameraFlyTo
          destination={Cesium.Cartesian3.fromDegrees(
            site.lng,
            site.lat,
            500
          )}
          orientation={{
            pitch: Cesium.Math.toRadians(-90),
            heading: 0,
            roll: 0,
          }}
          duration={0}
          onComplete={() => setCameraInitialized(true)}
        />
      )}

      {/*
        3D buildings tileset layer.

        Provides realistic urban visualization
        for spatial context around radar objects.
      */}
      <Cesium3DTileset url={osmBuildingsUrl} />

      {/*
        Static radar detector markers.

        Each road detector is rendered as a ground-clamped point
        representing radar hardware position.
      */}
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
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          }}
        />
      ))}

      {/*
        Dynamic vehicle and pedestrian rendering.

        Objects are streamed from radar data and converted
        to world coordinates. Each entity is oriented using
        heading correction to match model alignment.
      */}
      {Array.from(vehicles.values()).map((v) => {

        /*
          Apply model-specific heading correction.
          Radar orientation differs from model orientation.
        */
        const offset =
          v.type === 8
            ? PED_HEADING_OFFSET
            : VEHICLE_HEADING_OFFSET;

        const heading = (v.heading + offset) % 360;

        return (
          <Entity
            key={v.id}
            position={v.position}

            /*
              Quaternion orientation based on heading.
              Ensures correct rotation in 3D space.
            */
            orientation={Cesium.Transforms.headingPitchRollQuaternion(
              v.position,
              new Cesium.HeadingPitchRoll(
                Cesium.Math.toRadians(heading),
                0,
                0
              )
            )}

            /*
              3D model selection based on object type.
              Pedestrian and vehicle use separate assets.
            */
            model={{
              uri: v.type === 8 ? pedModelUrl : vehicleModelUrl,
              minimumPixelSize: 64,
              maximumScale: 20000,
              scale: v.type === 8 ? 1.5 : 0.5,
              heightReference:
                Cesium.HeightReference.CLAMP_TO_GROUND,
            }}
          />
        );
      })}
    </Viewer>
  );
}