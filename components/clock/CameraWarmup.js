'use client';
import { useEffect } from 'react';
import { acquireClockCamera } from '@/lib/clock-camera';

// Start the shared camera while the employee enters their PIN. No photo is taken
// here. Bound the warmup so an abandoned PIN/action screen cannot leave it on.
export default function CameraWarmup({ active }) {
  useEffect(() => {
    if (!active) return;
    const camera = acquireClockCamera();
    camera.ready.catch(() => {}); // The capture screen provides permission/retry UI.
    const timer = setTimeout(camera.release, 20000);
    return () => { clearTimeout(timer); camera.release(); };
  }, [active]);
  return null;
}
