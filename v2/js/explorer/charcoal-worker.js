/* Background worker for the base map: recolours tiles off the main thread (see charcoal.js),
   so panning and zooming stay smooth while tiles stream in. Replies with a transferable
   ImageBitmap that the page hands to a canvas without copying. */
import { recolour } from "./charcoal.js";

self.onmessage = async ({ data: { id, base, hill } }) => {
  try {
    const cv = await recolour(base, hill, (w, h) => new OffscreenCanvas(w, h));
    const bmp = cv.transferToImageBitmap();
    self.postMessage({ id, bmp }, [bmp]);
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message || e) });
  }
};
