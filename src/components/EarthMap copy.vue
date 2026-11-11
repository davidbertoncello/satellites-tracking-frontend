<script setup lang="ts">
import { onMounted, reactive } from "vue";
// import { Cartesian3, JulianDate, SampledPositionProperty } from "cesium";
import type { VcReadyObject } from "vue-cesium/es/utils/types";
// import * as satelliteJS from "satellite.js";

const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   25237.49704057  .00011679  00000+0  21103-3 0  9998
2 25544  51.6352 323.5450 0003283 269.6475  90.4138 15.50171099525916`;

let Cesium: any;

const satellites = reactive([
  {
    name: "ISS",
    tle: ISS_TLE,
    // positions: null as SampledPositionProperty | null,
  },
]);

onMounted(() => {});

const foo = () => {
  const positions = new Cesium.SampledPositionProperty();
  // 1. Definindo um instante de tempo
  const time1 = Cesium.JulianDate.fromDate(new Date()); // agora
  const time2 = Cesium.JulianDate.fromDate(new Date(Date.now() + 10000)); // +1 segundo
  // // 2. Definindo posições conhecidas nesses instantes
  const pos1 = Cesium.Cartesian3.fromDegrees(-43.2, -22.9, 400000); // Rio de Janeiro
  const pos2 = Cesium.Cartesian3.fromDegrees(2.3, 48.8, 400000); // Paris
  positions.addSample(time1, pos1);
  positions.addSample(time2, pos2);
  console.log(pos1, pos2);
};

const onViewerReady = (readyObj: VcReadyObject) => {
  console.log("Viewer ready");
  console.dir(readyObj); // Cesium namespace object
  console.dir(readyObj.Cesium); // Cesium namespace object
  Cesium = readyObj.Cesium;
  foo();
};
</script>

<template>
  <vc-viewer
    :timeline="false"
    :animation="false"
    :shouldAnimate="false"
    :baseLayerPicker="false"
    :fullscreenButton="false"
    :geocoder="false"
    class="h-full w-full"
    @ready="onViewerReady"
  >
    <vc-layer-imagery>
      <vc-imagery-provider-urltemplate
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        :minimum-level="0"
        :maximum-level="20"
      />
    </vc-layer-imagery>

    <!-- height(altitude) in meters -->
    <vc-camera
      :position="{ lng: -43.1729, lat: -22.9068, height: 2_000_000 }"
    />

    <!-- Satellites at coordinates -->
    <vc-entity
      :position="{ latitude: -22.9068, longitude: -43.1729, height: 2_000_000 }"
      :point="{ pixelSize: 28, color: 'red' }"
    ></vc-entity>
  </vc-viewer>
</template>

<style scoped></style>
