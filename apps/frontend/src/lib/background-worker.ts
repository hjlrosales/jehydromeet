/// <reference lib="webworker" />

/**
 * background-worker.ts
 *
 * Web Worker that runs MediaPipe ImageSegmenter for background segmentation.
 * Receives ImageBitmap frames from the main thread, runs segmentation,
 * and returns the confidence mask as a Float32Array.
 *
 * Uses @mediapipe/tasks-vision FilesetResolver + ImageSegmenter.
 *
 * Messages from main thread:
 *   { type: 'segment', bitmap: ImageBitmap }
 *
 * Messages to worker (from main thread):
 *   { type: 'segment', bitmap: ImageBitmap }
 *
 * Messages to main thread:
 *   { type: 'mask', mask: { mask: Float32Array, width, height } }
 *   { type: 'error', error: string }
 *   { type: 'ready' }
 */

// We'll load these from the CDN for easy WASM delivery.
// In production, host these files alongside the app for reliability.
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float32/latest/selfie_segmenter_landscape.tflite'; // pinned in code alongside wasm base
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

let segmenter: any = null; // ImageSegmenter instance
let isInitialized = false;

/**
 * Initialize the ImageSegmenter.
 * Called once on first segmentation request.
 */
async function initSegmenter(): Promise<void> {
  if (isInitialized) return;

  try {
    // Dynamically import the MediaPipe tasks-vision library
    // (loaded in the worker context via importScripts or dynamic import)
    const { ImageSegmenter, FilesetResolver } = await loadMediaPipeModule();

    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      outputCategoryMask: true,
      runningMode: 'VIDEO',
    });

    isInitialized = true;
    self.postMessage({ type: 'ready' });
  } catch (err: any) {
    // If GPU fails, try CPU
    try {
      const { ImageSegmenter, FilesetResolver } = await loadMediaPipeModule();
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'CPU',
        },
        outputCategoryMask: true,
        runningMode: 'VIDEO',
      });
      isInitialized = true;
      self.postMessage({ type: 'ready' });
    } catch (cpuErr: any) {
      self.postMessage({
        type: 'error',
        error: `Failed to initialize segmentation: ${cpuErr?.message ?? 'unknown'}`,
      });
    }
  }
}

/**
 * Dynamically load the MediaPipe module.
 * In a worker context, we use importScripts or a workaround.
 * @mediapipe/tasks-vision supports worker environments via its WASM loader.
 */
async function loadMediaPipeModule(): Promise<{
  ImageSegmenter: any;
  FilesetResolver: any;
}> {
  // In a worker context, use importScripts to load the UMD bundle
  // This is the recommended way for @mediapipe/tasks-vision in workers.
  self.importScripts(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.js'
  );
  // The bundle exports to self (global scope in worker)
  return {
    ImageSegmenter: (self as any).ImageSegmenter,
    FilesetResolver: (self as any).FilesetResolver,
  };
}

/**
 * Run segmentation on an ImageBitmap.
 */
async function segment(bitmap: ImageBitmap): Promise<void> {
  if (!isInitialized) {
    try {
      await initSegmenter();
    } catch {
      self.postMessage({ type: 'error', error: 'Segmentation init failed' });
      return;
    }
  }

  if (!segmenter) {
    self.postMessage({ type: 'error', error: 'Segmenter not available' });
    return;
  }

  try {
    const result = segmenter.segmentForVideo(bitmap, performance.now());
    const mask = result?.categoryMask?.getAsFloat32Array();

    if (mask) {
      self.postMessage(
        {
          type: 'mask',
          mask: {
            // The mask from selfie_segmenter_landscape outputs 0=background, 1=person
            // We invert it if needed - let's keep it as-is (0=bg, 1=person)
            mask,
            width: result.categoryMask.width,
            height: result.categoryMask.height,
          },
        },
        // Transfer the ArrayBuffer for zero-copy
        [mask.buffer]
      );
    } else {
      self.postMessage({ type: 'error', error: 'No mask returned' });
    }
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      error: `Segmentation failed: ${err?.message ?? 'unknown'}`,
    });
  } finally {
    // Close the bitmap (we own it since it was transferred)
    bitmap.close();
  }
}

// -----------------------------------------------------------
// Message handler
// -----------------------------------------------------------
self.onmessage = async (e: MessageEvent) => {
  const { type, bitmap } = e.data;

  if (type === 'segment' && bitmap instanceof ImageBitmap) {
    await segment(bitmap);
  }
};
