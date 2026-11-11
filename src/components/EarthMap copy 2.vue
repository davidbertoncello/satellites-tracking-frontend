<template>
  <vc-viewer ref="viewerRef" @ready="onViewerReady">
    <vc-entity
      v-if="satPosition"
      :position="satPosition"
      :point="{ pixelSize: 28, color: 'red' }"
      :label="{
        text: 'Satélite',
        font: '14pt sans-serif',
        fillColor: 'white',
        outlineColor: 'black',
        outlineWidth: 2,
        style: 1,
        pixelOffset: { x: 0, y: -40 },
      }"
    />
  </vc-viewer>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";

const viewerRef = ref(null);
const satPosition = ref<any>(null);

const onViewerReady = (readyObj: any) => {
  const { Cesium, viewer } = readyObj;

  // Configurar o tempo de simulação
  const start = Cesium.JulianDate.fromDate(new Date());
  const stop = Cesium.JulianDate.addSeconds(start, 60, new Cesium.JulianDate());

  viewer.clock.startTime = start.clone();
  viewer.clock.stopTime = stop.clone();
  viewer.clock.currentTime = start.clone();
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
  viewer.clock.multiplier = 1;

  // Criar a propriedade de posição do satélite
  const property = new Cesium.SampledPositionProperty();

  // Posições do satélite (órbita simulada)
  const positions = [
    { lon: -43.2, lat: -22.9, height: 400000 }, // Rio de Janeiro
    { lon: -34.6, lat: -58.4, height: 400000 }, // Buenos Aires
    { lon: -79.0, lat: -2.2, height: 400000 }, // Quito
    { lon: -74.0, lat: 40.7, height: 400000 }, // Nova York
    { lon: 2.3, lat: 48.8, height: 400000 }, // Paris
    { lon: 37.6, lat: 55.8, height: 400000 }, // Moscou
    { lon: 116.4, lat: 39.9, height: 400000 }, // Pequim
    { lon: 139.7, lat: 35.7, height: 400000 }, // Tóquio
    { lon: 151.2, lat: -33.9, height: 400000 }, // Sydney
    { lon: -43.2, lat: -22.9, height: 400000 }, // Volta ao Rio
  ];

  // Adicionar amostras de posição ao longo do tempo
  positions.forEach((pos, index) => {
    const time = Cesium.JulianDate.addSeconds(
      start,
      index * 6,
      new Cesium.JulianDate()
    );
    const position = Cesium.Cartesian3.fromDegrees(
      pos.lon,
      pos.lat,
      pos.height
    );
    property.addSample(time, position);
  });

  // Definir a posição inicial
  satPosition.value = property;

  // Centralizar a câmera na primeira posição
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-43.2, -22.9, 1000000),
    orientation: {
      heading: 0.0,
      pitch: -Cesium.Math.PI_OVER_TWO,
      roll: 0.0,
    },
  });

  // Iniciar a animação
  viewer.clock.shouldAnimate = true;

  console.log("Satélite configurado com sucesso!");
  console.log("Posições:", positions.length);
};
</script>
