<template>
  <EarthMap />
</template>

<script setup lang="ts">
import { onBeforeMount } from "vue";
import { useSatelliteStore } from "@/store/satellite";
import EarthMap from "./EarthMap.vue";

const satelliteStore = useSatelliteStore();

onBeforeMount(async () => {
  await satelliteStore.loadSatellites();
});
</script>

<style scoped></style>
