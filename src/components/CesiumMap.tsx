import { useEffect } from "react";
import * as Cesium from "cesium";
import { useCesium } from "../hooks/useCesium";
import { assetIds } from "../config/cesiumConfig";

export default function CesiumMap() {
  const { containerRef, viewer } = useCesium();

  useEffect(() => {
    if (!viewer) return;

    // Create an async function to handle the initialization
    const initializeMap = async () => {
      // Position - Monas Jakarta
      viewer.camera.flyTo({
        destination: Cesium. Cartesian3.fromDegrees(106.8129, -6.1751, 400),
        orientation:  {
          heading: Cesium.Math.toRadians(0.0),
          pitch: Cesium.Math.toRadians(-15.0),
        }
      });

      // Init resource and tile sets 
      const resources = {
        car: await Cesium.IonResource.fromAssetId(assetIds. car)
      };
      

    };

    // Call the async function
    initializeMap();

  }, [viewer]);

  return (
    <div
      ref={containerRef}
      // style={{ width:  "100%", height: "100%" }}
    />
  );
}