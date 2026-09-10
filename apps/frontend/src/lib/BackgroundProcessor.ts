/**
 * BackgroundProcessor
 *
 * Wraps a camera MediaStream and applies background effects (blur, virtual
 * image, or passthrough) using canvas-based compositing powered by MediaPipe
 * ImageSegmenter (from @mediapipe/tasks-vision).
 *
 * The processor:
 *   1. Captures raw camera frames via <video> element
 *   2. Runs segmentation (person/background mask) via a Web Worker
 *   3. Composites the result onto an offscreen canvas
 *   4. Outputs a processed MediaStream via canvas.captureStream()
 *   5. Monitors frame rate and auto-disables effects on low-end devices
 *
 * Usage:
 *   const proc = new BackgroundProcessor(rawCameraStream);
 *   await proc.init();
 *   proc.setEffect('blur');
 *   const processedStream = proc.outputStream; // replace camera track with this
 */

import type { BackgroundEffect, BackgroundImagePresetId } from '@jehydro/shared-types';
import { BACKGROUND_IMAGE_PRESETS } from '@jehydro/shared-types';

// Shared type between main thread and worker
export interface SegmentationResult {
  /** Float32Array of mask values (0 = background, 1 = person) */
  mask: Float32Array;
  width: number;
  height: number;
}

const SEGMENTATION_WIDTH = 256;
const SEGMENTATION_HEIGHT = 144;
const MIN_FPS = 15; // auto-disable if below this for 1 second
const FPS_SAMPLE_WINDOW = 1000; // ms

export class BackgroundProcessor {
  private rawStream: MediaStream;
  private videoEl: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private outputStream: MediaStream | null = null;
  private animationId: number | null = null;

  private effect: BackgroundEffect = 'none';
  private backgroundImage: HTMLImageElement | null = null;
  private imageId: string | null = null;

  // Segmentation
  private worker: Worker | null = null;
  private isProcessing = false;
  private latestMask: SegmentationResult | null = null;
  private maskReady = false;
  private frameCount = 0;
  private lastFpsCheck = 0;
  private currentFps = 30;
  private autoDisabled = false;

  // Blur intensity
  private readonly BLUR_RADIUS = 12;

  constructor(rawStream: MediaStream) {
    this.rawStream = rawStream;
  }

  /**
   * Initialize the processor: create video element, canvas, load model, start loop.
   */
  async init(): Promise<void> {
    // Create hidden video element to consume the raw stream
    const video = document.createElement('video');
    video.srcObject = this.rawStream;
    video.muted = true;
    video.playsInline = true;
    video.width = SEGMENTATION_WIDTH;
    video.height = SEGMENTATION_HEIGHT;
    await video.play();
    this.videoEl = video;

    // Create canvas at video resolution. HTMLCanvasElement supports captureStream().
    const track = this.rawStream.getVideoTracks()[0];
    const settings = track?.getSettings();
    const width = settings?.width ?? 640;
    const height = settings?.height ?? 480;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;

    // Create the output stream from the canvas
    this.outputStream = this.canvas.captureStream(30);

    // Load background images
    this.preloadImages();

    // Start processing loop
    this.lastFpsCheck = performance.now();
    this.frameCount = 0;
    this.startLoop();
  }

  /**
   * Get the processed output stream (replace raw camera track with this).
   */
  getOutputStream(): MediaStream | null {
    return this.outputStream;
  }

  /**
   * Get the current FPS of the processing loop.
   */
  getCurrentFps(): number {
    return this.currentFps;
  }

  /**
   * Whether the processor auto-disabled due to low frame rate.
   */
  isAutoDisabled(): boolean {
    return this.autoDisabled;
  }

  /**
   * Set the background effect.
   * 'none' — passthrough (raw camera, no processing)
   * 'blur' — gaussian blur on background
   * 'image' — replace background with preset image
   */
  setEffect(effect: BackgroundEffect, imageId?: BackgroundImagePresetId): void {
    this.effect = effect;
    this.autoDisabled = false;

    if (effect === 'none') {
      // Passthrough: just copy raw frames to canvas (no segmentation needed)
      return;
    }

    if (effect === 'image' && imageId && imageId !== this.imageId) {
      this.imageId = imageId;
      this.loadBackgroundImage(imageId);
    }

    // Ensure worker is running
    this.ensureWorker();
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
    if (this.outputStream) {
      this.outputStream.getTracks().forEach(t => t.stop());
      this.outputStream = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.rawStream = new MediaStream(); // empty, caller should also stop their stream
  }

  // -----------------------------------------------------------
  // Private processing loop
  // -----------------------------------------------------------

  private startLoop(): void {
    const loop = async () => {
      this.processFrame();
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  private async processFrame(): Promise<void> {
    if (!this.videoEl || !this.canvas || !this.ctx) return;
    if (this.autoDisabled) {
      // Passthrough: just copy the raw frame
      this.ctx.drawImage(this.videoEl, 0, 0);
      return;
    }

    const video = this.videoEl;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (this.effect === 'none') {
      // Passthrough
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      // Use segmentation mask
      if (this.latestMask && this.maskReady) {
        this.maskReady = false;
        this.compositeWithMask(video, ctx, w, h);
      } else {
        // No mask yet — show raw frame until segmentation kicks in
        ctx.drawImage(video, 0, 0, w, h);
      }

      // Request a new segmentation frame (throttled)
      if (!this.isProcessing) {
        this.requestSegmentation();
      }
    }

    // FPS monitoring
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsCheck >= FPS_SAMPLE_WINDOW) {
      this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsCheck));
      this.frameCount = 0;
      this.lastFpsCheck = now;

      if (this.currentFps < MIN_FPS && this.effect !== 'none') {
        console.warn(
          `[BackgroundProcessor] Low FPS (${this.currentFps}), auto-disabling effect`
        );
        this.autoDisabled = true;
        this.effect = 'none';
      }
    }
  }

  // -----------------------------------------------------------
  // Compositing
  // -----------------------------------------------------------

  private compositeWithMask(
    video: HTMLVideoElement,
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number
  ): void {
    const mask = this.latestMask!;

    // Draw background
    switch (this.effect) {
      case 'blur': {
        // Draw the raw frame and apply blur
        ctx.drawImage(video, 0, 0, w, h);
        this.applyBlur(ctx, w, h);
        break;
      }
      case 'image': {
        if (this.backgroundImage) {
          ctx.drawImage(this.backgroundImage, 0, 0, w, h);
        } else {
          // Fallback: solid color
          ctx.fillStyle = '#2d3748';
          ctx.fillRect(0, 0, w, h);
        }
        break;
      }
      default:
        break;
    }

    // Composite the person on top using the mask
    // We draw the raw video frame but only where the mask has person pixels
    this.compositePerson(video, ctx, w, h, mask);
  }

  private applyBlur(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    // Downscale for performance then blur
    const scaleW = Math.round(w / 4);
    const scaleH = Math.round(h / 4);

    // We can't easily do stack blur on OffscreenCanvas without ImageData.
    // Use a simple box blur via ImageData manipulation:
    try {
      // For a fast blur, we draw at low-res and scale back up
      // This creates a pixelated blur effect
      const tempCanvas = new OffscreenCanvas(scaleW, scaleH);
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(ctx.canvas, 0, 0, scaleW, scaleH);
      ctx.filter = `blur(${this.BLUR_RADIUS}px)`;
      ctx.drawImage(tempCanvas, 0, 0, w, h);
      ctx.filter = 'none';
    } catch {
      // Fallback: solid dark color
      ctx.fillStyle = '#1a202c';
      ctx.fillRect(0, 0, w, h);
    }
  }

  private compositePerson(
    video: HTMLVideoElement,
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    mask: SegmentationResult
  ): void {
    const maskW = mask.width;
    const maskH = mask.height;

    // Use canvas compositing: draw the person from the video frame
    // by using the mask as an alpha channel
    // We use a technique: draw video into a temp canvas, apply mask via ImageData,
    // then draw back onto main canvas

    const tempCanvas = new OffscreenCanvas(w, h);
    const tempCtx = tempCanvas.getContext('2d')!;

    // Draw video frame onto temp canvas
    tempCtx.drawImage(video, 0, 0, w, h);

    // Apply mask to the tempx canvas pixels
    const imageData = tempCtx.getImageData(0, 0, w, h);
    const pixels = imageData.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Map to mask coordinates (bilinear would be better, but nearest is fast)
        const mx = Math.round((x / w) * maskW);
        const my = Math.round((y / h) * maskH);
        const maskIdx = my * maskW + mx;
        const confidence = mask.mask[maskIdx] ?? 0;

        // If background, set alpha to 0 (will show background layer beneath)
        const pixelIdx = (y * w + x) * 4;
        pixels[pixelIdx + 3]! = Math.round(confidence * 255);
      }
    }

    tempCtx.putImageData(imageData, 0, 0);

    // Draw the masked person on top of the background
    ctx.drawImage(tempCanvas, 0, 0);
  }

  // -----------------------------------------------------------
  // Segmentation (Web Worker)
  // -----------------------------------------------------------

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = new Worker(new URL('./background-worker.ts', import.meta.url));
    this.worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'mask') {
        this.latestMask = e.data.mask as SegmentationResult;
        this.maskReady = true;
        this.isProcessing = false;
      } else if (e.data.type === 'error') {
        console.error('[BackgroundProcessor] Worker error:', e.data.error);
        this.isProcessing = false;
      }
    };
    this.worker.onerror = (err) => {
      console.error('[BackgroundProcessor] Worker fatal error:', err);
      this.isProcessing = false;
      this.autoDisabled = true;
      this.effect = 'none';
    };
  }

  private requestSegmentation(): void {
    if (!this.worker || !this.videoEl || this.isProcessing) return;
    this.isProcessing = true;

    // Create an ImageBitmap from the current video frame
    try {
      createImageBitmap(this.videoEl, {
        resizeWidth: SEGMENTATION_WIDTH,
        resizeHeight: SEGMENTATION_HEIGHT,
        resizeQuality: 'medium',
      }).then((bitmap) => {
        this.worker?.postMessage(
          { type: 'segment', bitmap },
          [bitmap]  // Transfer ownership (zero-copy)
        );
      }).catch((err) => {
        console.warn('[BackgroundProcessor] createImageBitmap failed:', err);
        this.isProcessing = false;
      });
    } catch {
      this.isProcessing = false;
    }
  }

  // -----------------------------------------------------------
  // Background images
  // -----------------------------------------------------------

  private preloadImages(): void {
    for (const preset of BACKGROUND_IMAGE_PRESETS) {
      const img = new Image();
      img.src = preset.url;
    }
  }

  private loadBackgroundImage(imageId: string): void {
    const preset = BACKGROUND_IMAGE_PRESETS.find((p) => p.id === imageId);
    if (!preset) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.backgroundImage = img;
    };
    img.onerror = () => {
      console.warn(`[BackgroundProcessor] Failed to load background image: ${preset.url}`);
    };
    img.src = preset.url;
  }
}
