/* NASA's public NISAR layers on ArcGIS Online (owner: NASA NISAR team, no login needed).
   Plain ArcGIS REST queries, so they work with our three.js globe and the Leaflet map. */
window.NASA_GIS = (function () {
  const BASE = "https://services7.arcgis.com/WSiUmUhlFx4CtMBB/arcgis/rest/services/";
  const PLANS = BASE + "nisar_merged_observation_plans/FeatureServer/0/query";
  const CALVAL = BASE + "calval_sites_062921/FeatureServer/0/query";

  const q = (url, params) =>
    fetch(url + "?" + new URLSearchParams({ f: "json", ...params })).then((r) => r.json()).then((j) => {
      if (j.error) throw new Error(j.error.message);
      return j;
    });

  // polygon rings (lon/lat) from an Esri JSON feature
  const rings = (f) => (f.geometry && f.geometry.rings) || [];

  // Upcoming acquisition dates (YYYY-MM-DD strings) from a plan feature
  function upcoming(attrs, from = new Date(), n = 3) {
    const today = from.toISOString().slice(0, 10);
    return (attrs.dates || "").split(",").map((s) => s.trim()).filter((d) => d >= today).slice(0, n);
  }

  return {
    source: "NASA NISAR layers on ArcGIS Online",
    sourceUrl: "https://www.arcgis.com/home/search.html?q=NISAR%20owner%3Aapeacoc1_NASA",

    // All planned frames that cover a point, with their pass dates
    async passesOver(lat, lon) {
      const j = await q(PLANS, {
        where: "1=1", geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: 4326,
        spatialRel: "esriSpatialRelIntersects", outSR: 4326, returnGeometry: true, geometryPrecision: 4,
        outFields: "track,frame,passdirection,dates,acquisition_time"
      });
      return j.features.map((f) => ({ ...f.attributes, rings: rings(f), next: upcoming(f.attributes) }));
    },

    // Every planned frame on one orbit track (both halves), simplified for the globe
    async track(track) {
      const j = await q(PLANS, {
        where: `track=${+track}`, outFields: "track,frame,passdirection,acquisition_time", returnGeometry: true,
        outSR: 4326, geometryPrecision: 3, maxAllowableOffset: 0.05
      });
      return j.features.map((f) => ({ ...f.attributes, rings: rings(f) })).sort((a, b) => a.frame - b.frame);
    },

    // NASA calibration/validation sites (centroids + descriptions)
    async calval() {
      const j = await q(CALVAL, {
        where: "1=1", outFields: "sitename,fullname,discipline,descript,valproduct,location",
        returnGeometry: false, returnCentroid: true, outSR: 4326
      });
      return j.features.filter((f) => f.centroid).map((f) => ({ ...f.attributes, lat: f.centroid.y, lon: f.centroid.x }));
    },

    upcoming
  };
})();
