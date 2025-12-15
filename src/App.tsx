import CesiumMap from "./components/Resium";

const siteData = {
  lat: 35.8358,
  lng: 129.2844,
  name: "인동네거리",
  roads: [
    {
      name: "인동네거리 접근로1 (동쪽)",
      road_id:1,
      detector: {
        detector_id: 1,
                lat: 35.835688213867485,
                lng: 129.2844012236187,
      },
    },
    {
      name: "인동네거리 접근로2 (남쪽)",
      road_id:2,
      detector: {
        detector_id: 2,
                lat: 35.83613420725703,
                lng: 129.28447607713775,
      },
    },
    {
      name: "인동네거리 접근로3 (서쪽)",
      road_id:3,
      detector: {
        detector_id: 3,
                lat: 35.8358906771183,
                lng: 129.2843483440428,
      },
    },
  ],
};

export default function Page() {
  return <CesiumMap site={siteData} />;
}
