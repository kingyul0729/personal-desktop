// Single-finger horizontal gestures only; vertical scrolling and slow drags are not page turns.
export function imageSwipeDirection(deltaX: number, deltaY: number, elapsed: number): -1 | 0 | 1 {
  if (elapsed < 0 || elapsed > 700 || Math.abs(deltaX) < 60 || Math.abs(deltaY) > 35 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return 0;
  return deltaX < 0 ? 1 : -1;
}
import type { ImageOrientation, PriceImage } from './priceFiles';

export function imageFitRatios(image: { width: number; height: number }, viewport: { width: number; height: number }, padding = 16) {
  const width = Math.max(1, viewport.width - padding * 2) / image.width;
  const page = Math.min(width, Math.max(1, viewport.height - padding * 2) / image.height);
  return { width, page };
}

export function getImageVariant(image: Pick<PriceImage, 'src' | 'variants'>, preferred: ImageOrientation) {
  const orientation = image.variants?.[preferred] ? preferred : image.variants?.landscape ? 'landscape' : image.variants?.portrait ? 'portrait' : undefined;
  return { src: orientation ? image.variants![orientation]! : image.src, orientation };
}
