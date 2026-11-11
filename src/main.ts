import { createApp } from "vue";
import { createPinia } from "pinia";
import "./style.css";
import App from "./App.vue";
import router from "./router";

import VueCesium from "vue-cesium";
import "vue-cesium/dist/index.css";
// import "cesium/Build/Cesium/Widgets/widgets.css";

const app = createApp(App);

// Usando a build do Cesium via CDN (evita configuração de assets/Workers no Vite).
// Versão fixa: o vue-cesium 3.2.9 usa Cesium.defaultValue, removido nas versões novas.
app
  .use(VueCesium, {
    cesiumPath: "https://unpkg.com/cesium@1.120.0/Build/Cesium/Cesium.js",
  })
  .use(router)
  .use(createPinia())
  .mount("#app");
