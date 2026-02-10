import { useMemo, useEffect, useState } from "react";
import { Viewer, Entity, Cesium3DTileset, CameraFlyTo } from "resium";
import * as Cesium from "cesium";
import { io, Socket } from "socket.io-client";
import { accessToken } from "../config/cesiumConfig";

Cesium.Ion.defaultAccessToken = accessToken;

// OSM Buildings
const osmBuildingsUrl = Cesium.IonResource.fromAssetId(96188);

// const VEHICLE_MODEL_ASSET_ID = assetIds.car;
// const PED_MODEL_ASSET_ID = assetIds.ped;


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

type VehicleState = {
  id: string;
  position: Cesium.Cartesian3;
  heading: number;
  type: number;
  lastUpdate: number;
};

function radarToWGS84(
  radarLat: number,
  radarLon: number,
  radarDirection: number,
  xpos: number,
  ypos: number
) {
  // Konstanta radius bumi (meter)
  const R = 6371000;

  // Konversi direction radar ke radian (0° = Utara, searah jarum jam)
  const dirRad = (radarDirection * Math.PI) / 180;

  // Rotasi koordinat lokal sesuai direction radar
  const rotatedX = xpos * Math.cos(dirRad) - ypos * Math.sin(dirRad);
  const rotatedY = xpos * Math.sin(dirRad) + ypos * Math.cos(dirRad);

  // Konversi radar lat/lon ke radian
  const lat1 = (radarLat * Math.PI) / 180;
  const lon1 = (radarLon * Math.PI) / 180;

  // Hitung perubahan latitude
  const dLat = rotatedY / R;

  // Hitung perubahan longitude (disesuaikan dengan latitude)
  const dLon = rotatedX / (R * Math.cos(lat1));

  // Koordinat akhir objek
  const objLat = lat1 + dLat;
  const objLon = lon1 + dLon;

  // Konversi ke derajat
  return {
    latitude: (objLat * 180) / Math.PI,
    longitude: (objLon * 180) / Math.PI,
  };
}

export default function CesiumMap({ site }: Props) {
  const [terrainProvider, setTerrainProvider] =
    useState<Cesium.TerrainProvider | null>(null);

  // const [vehicleModelUrl, setVehicleModelUrl] = 
  //   useState<string | null>(null);
  // const [pedModelUrl, setPedModelUrl] = 
  //   useState<string | null>(null);
  const [vehicleModelUrl] = useState("/models/car.glb");
  const [pedModelUrl] = useState("/models/ped.glb");

    
  const [vehicles, setVehicles] = useState<Map<string, VehicleState>>(
    new Map()
  );

  const [cameraInitialized, setCameraInitialized] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Load terrain
    Cesium.createWorldTerrainAsync().then((provider) => {
      if (mounted) setTerrainProvider(provider);
    });

    // // Load vehicle model
    // Cesium.IonResource.fromAssetId(VEHICLE_MODEL_ASSET_ID).then((resource) => {
    //   if (mounted) setVehicleModelUrl(resource);
    // });

    // // Load pedestrian model
    // Cesium.IonResource.fromAssetId(PED_MODEL_ASSET_ID).then((resource) => {
    //   if (mounted) setPedModelUrl(resource);
    // });


    return () => {
      mounted = false;
    };
  }, []);

  // Auto cleanup vehicles
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setVehicles((prev) => {
        const next = new Map(prev);
        let hasChanges = false;

        next.forEach((vehicle, id) => {
          if (now - vehicle.lastUpdate > 3000) {
            next.delete(id);
            hasChanges = true;
            console.log(`Removed stale vehicle: ${id}`);
          }
        });

        return hasChanges ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

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

  useEffect(() => {
    if (!terrainProvider || !vehicleModelUrl || !pedModelUrl || detectorMap.size === 0) return;

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

      console.log("Received radar data:", msg.data.length, "objects");

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

          // heading absolut (direction radar + heading objek)
          const absoluteHeading = (radar.direction_deg + (obj.heading || 0)) % 360;

          console.log(`Vehicle ${id}:`, {
            xpos: obj.xpos,
            ypos: obj.ypos,
            lat: wgs84.latitude,
            lon: wgs84.longitude,
            heading: absoluteHeading,
            type: obj.object_type
          });

          next.set(id, {
            id,
            position,
            heading: absoluteHeading,
            type: obj.object_type,
            lastUpdate: Date.now()
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
            pitch: Cesium.Math.toRadians(-90),
            heading: 0,
            roll: 0,
          }}
          duration={0}
          onComplete={() => setCameraInitialized(true)}
        />
      )}

      <Cesium3DTileset url={osmBuildingsUrl} />

      {/* Radar positions */}
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
          label={{
            text: road.name,
            pixelOffset: new Cesium.Cartesian2(0, -15),
            scale: 0.5,
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          }}
        />
      ))}

      {Array.from(vehicles.values()).map((v) => {
        const headingOffset = v.type === 8 ? PED_HEADING_OFFSET : VEHICLE_HEADING_OFFSET;
        const correctedHeading = (v.heading + headingOffset) % 360;
        
        return (
          <Entity
            key={v.id}
            position={v.position}
            orientation={Cesium.Transforms.headingPitchRollQuaternion(
              v.position,
              new Cesium.HeadingPitchRoll(
                Cesium.Math.toRadians(correctedHeading),
                0,
                0
              )
            )}
            model={{
              uri: v.type === 8 ? pedModelUrl : vehicleModelUrl,
              minimumPixelSize: 64,
              maximumScale: 20000,
              scale: v.type === 8 ? 1.5 : 0.5,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            }}
            label={{
              text: `${v.type}`,
              pixelOffset: new Cesium.Cartesian2(0, -30),
              scale: 0.5,
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              show: true,
            }}
          />
        );
      })}
    </Viewer>
  );
}