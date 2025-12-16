import CesiumMap from "./components/Resium";
// import CesiumMap from "./components/CesiumMap";

const siteData = {
  lat: 35.8358,
  lng: 129.2844,
  name: "인동네거리",
  site_id: 213,
  roads: [
    {
      name: "인동네거리 접근로1 (동쪽)",
      road_id: 55,
      detector: {
        detector_id: 117,
        lat: 35.835688213867485,
        lng: 129.2844012236187,
        direction_deg: 270.66775847733135,
      },
    },
    {
      name: "인동네거리 접근로2 (남쪽)",
      road_id: 56,
      detector: {
        detector_id: 6,
        lat: 35.83613420725703,
        lng: 129.28447607713775,
        direction_deg: 270.66775847733135
      },
    },
    {
      name: "인동네거리 접근로3 (서쪽)",
      road_id: 57,
      detector: {
        detector_id: 116,
        direction_deg: 1,
        lat: 35.8358906771183,
        lng: 129.2843483440428,
      },
    },
  ],
};

export default function Page() {
  return <CesiumMap site={siteData} />;
}
